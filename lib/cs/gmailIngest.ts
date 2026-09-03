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
        const cls = await classifyEmail({
          brand: account.brand,
          fromName: latestName,
          fromEmail: latestEmail,
          subject: latestSubject,
          bodySnippet: latestText || latestIncoming.snippet || "",
        });
        if (!cls.isCs) {
          classifiedOut++;
          // 무엇이 왜 떨어졌는지 남긴다. 예전엔 카운트만 있어서, 진짜 고객 문의가
          // 섞여 떨어져도 아무 흔적이 없었다(2026-09-03 박민 고객 [HARRIOT 문의] 유실).
          // 기록 실패가 수집을 막아선 안 되므로 통째로 감싼다.
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
              category: cls.category,
              confidence: cls.confidence,
              reason: cls.reason?.slice(0, 500) ?? null,
              // 분류가 '실패'해서 스킵된 건은 진짜 비CS와 뜻이 다르다 — 재시도 대상이다.
              failed: /분류 실패/.test(cls.reason ?? ""),
            }, { onConflict: "gmail_message_id" });
          } catch (e) {
            console.warn("[gmail-ingest] classified_out 기록 실패:", e instanceof Error ? e.message : e);
          }
          continue;
        }
        // Gemini 무료쿼터 429 버스트 방지 — 분류 호출 간 짧은 간격
        await new Promise((r) => setTimeout(r, 400));

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
