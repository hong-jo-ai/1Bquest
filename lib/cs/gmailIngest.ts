import { ingestMessage } from "./store";
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
} from "./classifier";
import type { CsChannel, IngestPayload } from "./types";

const SIXSHOP_SENDER_PATTERNS = [/sixshop/i, /식스샵/, /noreply@.*sixshop/i];
const CAFE24_SENDER_PATTERNS = [/cafe24/i, /카페24/, /cafe24corp/i];

/**
 * 명백한 시스템·자동발송 메일 — 분류기 호출 전에 즉시 차단.
 */
const HARD_SKIP_PATTERNS = [
  /noreply/i,
  /no-reply/i,
  /donotreply/i,
  /do-not-reply/i,
  /mailer-daemon/i,
  /postmaster@/i,
  /notification@/i,
  /alert@/i,
  /alerts?@/i,
  /support@google/i,
  /accounts\.google/i,
  /security@google/i,
  /noreply@(meta|facebook|instagram|github|vercel|supabase|youtube)/i,
  /@stripe\.com$/i,
  /naver\.com.*pay/i,
  /kakao(pay|corp)/i,
  /tossbank|tosspayments/i,
  /\.bank\./i,
  /@(shinhan|kookmin|kb|woori|hana|nh|ibk|sc|citi)/i,
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

export async function syncAllGmailAccounts(): Promise<{
  accounts: number;
  inserted: number;
  skipped: number;
  classifiedOut: number;
  errors: string[];
}> {
  const accounts = await listGmailAccounts();
  const blacklist = await getSenderBlacklist();
  let inserted = 0;
  let skipped = 0;
  let classifiedOut = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const accessToken = await getGmailAccessToken(account);
      const recent = await fetchRecentInboxMessages(accessToken, {
        maxResults: 50,
      });

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

        if (
          latestFromHeader &&
          HARD_SKIP_PATTERNS.some((r) => r.test(latestFromHeader))
        ) {
          skipped++;
          continue;
        }
        if (isBlacklisted(latestEmail, blacklist)) {
          skipped++;
          continue;
        }

        const latestSubject = extractHeader(latestIncoming, "Subject") ?? "(제목 없음)";
        const { text: latestText } = extractBody(latestIncoming);

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
          continue;
        }

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
