import { ingestMessage } from "./store";
import {
  extractBody,
  extractHeader,
  fetchRecentInboxMessages,
  getGmailAccessToken,
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

/**
 * 식스샵은 공개 API가 없으므로 관리자 알림 메일을 직접 수집한다.
 */
const SIXSHOP_SENDER_PATTERNS = [/sixshop/i, /식스샵/, /noreply@.*sixshop/i];

/**
 * 폴바이스: 카페24 알림. 2단계에서 정식 API로 대체.
 */
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
      const messages = await fetchRecentInboxMessages(accessToken, {
        maxResults: 50,
      });

      for (const msg of messages) {
        const fromHeader = extractHeader(msg, "From");
        const { name, email } = parseFrom(fromHeader);

        // 1차: 자기 자신이 보낸 것 (Sent에서 InBox에 같이 잡힌 케이스)
        if (
          email &&
          email.toLowerCase() === account.displayName.toLowerCase()
        ) {
          skipped++;
          continue;
        }

        // 2차: 명백한 시스템·자동발송 (정규식)
        if (fromHeader && HARD_SKIP_PATTERNS.some((r) => r.test(fromHeader))) {
          skipped++;
          continue;
        }

        // 3차: 사용자 학습 차단 목록
        if (isBlacklisted(email, blacklist)) {
          skipped++;
          continue;
        }

        const subject = extractHeader(msg, "Subject") ?? "(제목 없음)";
        const { text, html } = extractBody(msg);
        const channel = detectChannel(fromHeader, account);

        // 식스샵·카페24 알림은 분류기 건너뛰고 그대로 수집 (게시판 채널로 태깅)
        const isPlatformAlert =
          channel === "sixshop_board" || channel === "cafe24_board";

        let aiReason = "필터 통과";
        if (!isPlatformAlert) {
          // 4차: AI 분류
          const cls = await classifyEmail({
            brand: account.brand,
            fromName: name,
            fromEmail: email,
            subject,
            bodySnippet: text || msg.snippet || "",
          });
          if (!cls.isCs) {
            classifiedOut++;
            continue;
          }
          aiReason = `${cls.category} (${cls.reason})`;
        }

        const payload: IngestPayload = {
          brand: account.brand,
          channel,
          externalThreadId: msg.threadId,
          externalMessageId: msg.id,
          customerHandle: email ?? undefined,
          customerName: name ?? undefined,
          subject,
          bodyText: text || undefined,
          bodyHtml: html || undefined,
          sentAt: new Date(Number(msg.internalDate)),
          direction: "in",
          raw: {
            labelIds: msg.labelIds,
            snippet: msg.snippet,
            classifier: aiReason,
          },
        };

        const result = await ingestMessage(payload);
        if (result.inserted) inserted++;
        else skipped++;
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
