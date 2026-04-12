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
import type { CsChannel, IngestPayload } from "./types";

/**
 * 식스샵은 공개 API가 없으므로, 관리자 알림 이메일을 직접 수집한다.
 * 해리엇 Gmail 계정(harriotwatches@gmail.com)으로 오는 식스샵 알림을 태깅.
 */
const SIXSHOP_SENDER_PATTERNS = [
  /sixshop/i,
  /식스샵/,
  /noreply@.*sixshop/i,
];

/**
 * 폴바이스 Gmail 계정으로 오는 카페24 알림을 태깅 (2단계에서 정식 API로 대체).
 */
const CAFE24_SENDER_PATTERNS = [
  /cafe24/i,
  /카페24/,
  /cafe24corp/i,
];

/**
 * 자동 스팸/마케팅 필터. 이 패턴에 매칭되면 아예 인박스에 넣지 않는다.
 */
const SKIP_SENDER_PATTERNS = [
  /noreply@google\.com/i,
  /no-reply@accounts\.google\.com/i,
  /mailer-daemon/i,
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
  errors: string[];
}> {
  const accounts = await listGmailAccounts();
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const accessToken = await getGmailAccessToken(account);
      const messages = await fetchRecentInboxMessages(accessToken, {
        maxResults: 30,
      });

      for (const msg of messages) {
        const fromHeader = extractHeader(msg, "From");
        if (fromHeader && SKIP_SENDER_PATTERNS.some((r) => r.test(fromHeader))) {
          skipped++;
          continue;
        }

        const subject = extractHeader(msg, "Subject") ?? "(제목 없음)";
        const { name, email } = parseFrom(fromHeader);
        const { text, html } = extractBody(msg);
        const channel = detectChannel(fromHeader, account);

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
          raw: { labelIds: msg.labelIds, snippet: msg.snippet },
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

  return { accounts: accounts.length, inserted, skipped, errors };
}
