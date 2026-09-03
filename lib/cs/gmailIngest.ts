import { ingestMessage, refreshThreadCustomer, getCsSupabase } from "./store";
import {
  extractBody,
  extractHeader,
  fetchFullGmailThread,
  fetchRecentInboxMessages,
  getGmailAccessToken,
  isFromSelf,
  listGmailAccounts,
  parseFrom,
  updateGmailSyncState,
  type GmailAccount,
} from "./gmailClient";
import {
  classifyEmail,
  getSenderBlacklist,
  isBlacklisted,
  isNonCsSender,
} from "./classifier";
import type { CsChannel, IngestPayload } from "./types";

/**
 * 우리 문의폼에서 나온 메일 — 제목이 우리가 정한 형식이다. 이건 정의상 고객 문의라
 * AI 에 물어볼 이유가 없다. 물어봤다가 쿼터가 막히면 오히려 유실된다(2026-09-03 사고).
 */
const OWN_FORM_SUBJECT = /^\s*(?:re\s*:|fwd?\s*:|답장\s*:)?\s*\[(HARRIOT|PAULVICE|해리엇|폴바이스)\s*문의\]/i;

const SIXSHOP_SENDER_PATTERNS = [/sixshop/i, /식스샵/, /noreply@.*sixshop/i];
const CAFE24_SENDER_PATTERNS = [/cafe24/i, /카페24/, /cafe24corp/i];

const NAVERPAY_CENTER_SENDER_PATTERNS = [
  /pay\.naver\.com/i,
  /네이버페이/,
  /naverpay/i,
];

function detectChannel(from: string | undefined, account: GmailAccount): CsChannel {
  if (!from) return "gmail";
  if (account.brand === "harriot" && SIXSHOP_SENDER_PATTERNS.some((r) => r.test(from))) {
    return "sixshop_board";
  }
  if (account.brand === "paulvice" && CAFE24_SENDER_PATTERNS.some((r) => r.test(from))) {
    return "cafe24_board";
  }
  return "gmail";
}

/**
 * 네이버페이센터 주문 상황 알림 메일인지 판정.
 * 발신자가 네이버페이 도메인 + 제목에 "주문 상황" 포함.
 */
function isNaverPayCenterNotice(
  from: string | undefined,
  subject: string
): boolean {
  if (!from) return false;
  if (!NAVERPAY_CENTER_SENDER_PATTERNS.some((r) => r.test(from))) return false;
  return /주문\s*상황/.test(subject);
}

/**
 * 네이버페이센터 알림 본문에서 "고객문의 N건" 추출.
 * 0건이거나 패턴 없으면 0 반환.
 */
function parseNaverPayInquiryCount(body: string): number {
  const m = body.match(/고객문의[^\d]{0,30}(\d+)\s*건/);
  if (!m) return 0;
  return Number(m[1]) || 0;
}

export async function syncAllGmailAccounts(): Promise<{
  accounts: number;
  inserted: number;
  skipped: number;
  classifiedOut: number;
  errors: string[];
}> {
  const accounts = await listGmailAccounts();
  const blacklist = await getSenderBlacklist();
  const db = getCsSupabase();

  // 이미 '실패가 아닌' 판정을 받은 메일 = 다시 물어볼 필요 없는 것.
  // (failed 인 건은 판정이 없었던 것이라 재시도 대상으로 남긴다)
  const judgedOut = new Set<string>();
  {
    const { data } = await db
      .from("cs_classified_out")
      .select("gmail_message_id")
      .eq("failed", false)
      .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
    for (const r of (data ?? []) as Array<{ gmail_message_id: string }>) judgedOut.add(r.gmail_message_id);
  }
  // 쿼터가 막히면 이번 사이클은 더 부르지 않는다.
  let quotaExhausted = false;
  // 함수 실행시간(300s) 안에 반드시 끝내고 결과를 저장한다. 넘길 것 같으면 분류를 멈추고
  // 남은 건 다음 사이클로 넘긴다 — 통째로 타임아웃 나면 그 사이클 작업이 전부 버려진다.
  const deadline = Date.now() + 240_000;
  let inserted = 0;
  let skipped = 0;
  let classifiedOut = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const accessToken = await getGmailAccessToken(account);
      let recent = await fetchRecentInboxMessages(accessToken, {
        maxResults: 50,
      });
      if (recent.length === 0) {
        // Google Workspace 계정(shong@ 등)은 받은편지함 카테고리 탭이 없어
        // 기본 쿼리의 category:primary 가 0건을 반환 → 카테고리 조건 없이 재시도. (2026-07-19)
        recent = await fetchRecentInboxMessages(accessToken, {
          maxResults: 50,
          query: "in:inbox -from:noreply -from:no-reply -from:donotreply newer_than:14d",
        });
      }

      // threadId로 중복 제거
      const threadIds = Array.from(new Set(recent.map((m) => m.threadId)));

      for (const threadId of threadIds) {
        let fullMsgs;
        try {
          fullMsgs = await fetchFullGmailThread(accessToken, threadId);
        } catch {
          continue;
        }
        if (fullMsgs.length === 0) continue;

        // 시간순 정렬 (Gmail은 보통 오래된 순 반환)
        fullMsgs.sort(
          (a, b) => Number(a.internalDate) - Number(b.internalDate)
        );

        // 최근 수신 메시지(=내가 아닌 것) 찾기 — 분류 판단 기준
        const latestIncoming = [...fullMsgs]
          .reverse()
          .find((m) => !isFromSelf(m, account.displayName));

        if (!latestIncoming) {
          // 전부 내가 보낸 것만 있는 스레드 (일방 발신) → 스킵
          skipped++;
          continue;
        }

        // 1차: blacklist & hard skip은 최근 incoming 메시지 기준
        const latestFromHeader = extractHeader(latestIncoming, "From");
        const { name: latestName, email: latestEmail } = parseFrom(latestFromHeader);

        if (isNonCsSender(latestFromHeader)) {
          skipped++;
          continue;
        }
        if (isBlacklisted(latestEmail, blacklist)) {
          skipped++;
          continue;
        }

        const latestSubject = extractHeader(latestIncoming, "Subject") ?? "(제목 없음)";
        const { text: latestText } = extractBody(latestIncoming);

        // 탈락 기록. 기록 실패가 수집을 막아선 안 되므로 통째로 감싼다.
        const recordDropped = async (v: {
          failed: boolean; category: string; confidence: number; reason: string | null;
        }) => {
          try {
            await db.from("cs_classified_out").upsert({
              brand: account.brand,
              account: account.displayName ?? null,
              gmail_message_id: latestIncoming.id,
              gmail_thread_id: latestIncoming.threadId ?? null,
              from_email: latestEmail ?? null,
              from_name: latestName ?? null,
              subject: latestSubject.slice(0, 500),
              snippet: (latestText || latestIncoming.snippet || "").slice(0, 1000),
              category: v.category,
              confidence: v.confidence,
              reason: v.reason?.slice(0, 500) ?? null,
              failed: v.failed,
            }, { onConflict: "gmail_message_id" });
          } catch (e) {
            console.warn("[gmail-ingest] classified_out 기록 실패:", e instanceof Error ? e.message : e);
          }
        };

        // 네이버페이센터 알림 메일: 본문 정형이라 AI 분류 우회.
        // 고객문의 0건이면 skip, N>0 이면 subject 만 알림용으로 가공해서 ingest.
        if (isNaverPayCenterNotice(latestFromHeader, latestSubject)) {
          const count = parseNaverPayInquiryCount(
            latestText || latestIncoming.snippet || ""
          );
          if (count === 0) {
            skipped++;
            continue;
          }
          const noticePayload: IngestPayload = {
            brand: account.brand,
            channel: "gmail",
            externalThreadId: latestIncoming.threadId,
            externalMessageId: latestIncoming.id,
            customerHandle: latestEmail ?? undefined,
            customerName: "네이버페이센터",
            subject: `[네이버페이센터] 고객문의 ${count}건 — 톡톡에서 응대`,
            bodyText: latestText || undefined,
            sentAt: new Date(Number(latestIncoming.internalDate)),
            direction: "in",
            raw: {
              labelIds: latestIncoming.labelIds,
              snippet: latestIncoming.snippet,
              naverpay_inquiry_count: count,
            },
          };
          const r = await ingestMessage(noticePayload);
          if (r.inserted) inserted++;
          else skipped++;
          continue;
        }

        // 2차: AI 분류 — 최근 수신 메시지 기준으로 스레드 전체를 판단
        // 우리 문의폼 메일은 분류를 건너뛴다(정의상 고객 문의). 쿼터도 아낀다.
        const isOwnForm = OWN_FORM_SUBJECT.test(latestSubject);
        // 이미 '실패가 아닌' 판정을 받은 메일은 다시 묻지 않는다. 예전엔 매 사이클
        // 같은 메일을 재분류해 하루치 쿼터를 새 메일이 아니라 옛 메일에 다 썼다.
        if (!isOwnForm && judgedOut.has(latestIncoming.id)) {
          classifiedOut++;
          continue;
        }
        // 쿼터가 이미 막혔으면 더 부르지 않는다. 429 를 연달아 맞아봐야
        // 남은 메일까지 같이 죽고, 다음 사이클 복구만 늦어진다.
        if (!isOwnForm && (quotaExhausted || Date.now() > deadline)) {
          classifiedOut++;
          await recordDropped({ failed: true, category: "other", confidence: 0, reason: quotaExhausted ? "분류 실패 → 스킵(쿼터 소진, 이번 사이클 중단)" : "분류 실패 → 스킵(시간 초과, 다음 사이클 재시도)" });
          continue;
        }

        const cls = isOwnForm
          ? { isCs: true, confidence: 1, category: "customer_inquiry" as const, reason: "우리 문의폼 제목 — 분류 생략" }
          : await classifyEmail({
              brand: account.brand,
              fromName: latestName,
              fromEmail: latestEmail,
              subject: latestSubject,
              bodySnippet: latestText || latestIncoming.snippet || "",
            });
        if (/429|RESOURCE_EXHAUSTED|quota/i.test(cls.reason ?? "")) quotaExhausted = true;

        if (cls.isCs) {
          // 예전에 실패로 남은 기록을 지운다. 안 지우면 429 로 한 번 실패했다가 나중에
          // 통과한 메일이 계속 '분류 실패'로 남아 일일 알림에 허위로 뜬다.
          try {
            await db.from("cs_classified_out").delete().eq("gmail_message_id", latestIncoming.id);
          } catch { /* 정리 실패는 수집을 막지 않는다 */ }
        }
        if (!cls.isCs) {
          classifiedOut++;
          await recordDropped({
            failed: /분류 실패/.test(cls.reason ?? ""),
            category: cls.category,
            confidence: cls.confidence,
            reason: cls.reason ?? null,
          });
          continue;
        }
        // (Gemini 무료쿼터 시절의 400ms 간격은 제거했다 — Anthropic 레이트리밋은 이 정도로 막히지 않고,
        //  그 대기가 쌓여 함수 타임아웃을 만들었다.)

        const channel = detectChannel(latestFromHeader, account);

        // 3차: 스레드 전체 메시지를 시간순으로 ingest
        // 마지막 ingest 호출의 direction이 cs_threads.status를 결정
        // (ingestMessage: in → 'unanswered', out → 'waiting')
        for (const m of fullMsgs) {
          const isOut = isFromSelf(m, account.displayName);
          const fromH = extractHeader(m, "From");
          const { name: n, email: e } = parseFrom(fromH);
          const subj = extractHeader(m, "Subject") ?? latestSubject;
          const { text, html } = extractBody(m);

          const payload: IngestPayload = {
            brand: account.brand,
            channel,
            externalThreadId: m.threadId,
            externalMessageId: m.id,
            customerHandle: isOut ? latestEmail ?? undefined : e ?? undefined,
            customerName: isOut ? latestName ?? undefined : n ?? undefined,
            subject: subj,
            bodyText: text || undefined,
            bodyHtml: html || undefined,
            sentAt: new Date(Number(m.internalDate)),
            direction: isOut ? "out" : "in",
            raw: {
              labelIds: m.labelIds,
              snippet: m.snippet,
              classifier: isOut ? undefined : `${cls.category} (${cls.reason})`,
            },
          };
          const result = await ingestMessage(payload);
          if (result.inserted) inserted++;
          else skipped++;
        }

        // 답장으로 지워진 고객 정보 보충 (dup 메시지여도 스레드 갱신)
        if (latestName || latestEmail) {
          await refreshThreadCustomer(channel, latestIncoming.threadId, {
            handle: latestEmail,
            name: latestName,
          });
        }
      }

      await updateGmailSyncState(account.id, { error: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${account.brand}/${account.displayName}: ${msg}`);
      await updateGmailSyncState(account.id, { error: msg });
    }
  }

  return { accounts: accounts.length, inserted, skipped, classifiedOut, errors };
}
