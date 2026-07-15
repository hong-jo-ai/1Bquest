import { ingestMessage } from "./store";
import {
  fetchIgMessages,
  listIgAccounts,
  listIgConversations,
  refreshIgLoginTokenIfNeeded,
  type IgAccount,
} from "./instagramClient";
import type { IngestPayload } from "./types";

export async function syncAllIgAccounts(opts: {
  sinceDays?: number;
  maxPages?: number;
} = {}): Promise<{
  accounts: number;
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const accounts = await listIgAccounts();
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  const since = opts.sinceDays
    ? new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000)
    : undefined;
  const maxPages = opts.maxPages ?? 1;

  for (let account of accounts) {
    try {
      // IG 로그인 토큰 만료 임박 시 자동 갱신(무기한 유지).
      account = await refreshIgLoginTokenIfNeeded(account);

      const conversations = await listIgConversations(account, {
        since,
        maxPages,
      });

      for (const conv of conversations) {
        let messages;
        try {
          messages = await fetchIgMessages(account, conv.id);
        } catch (e) {
          errors.push(
            `${account.displayName} conv ${conv.id}: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          continue;
        }

        // 시간순 정렬 (Meta는 최근순 반환)
        messages.sort(
          (a, b) =>
            new Date(a.created_time).getTime() -
            new Date(b.created_time).getTime()
        );

        // 상대방 찾기.
        // 대화 목록에서 participants 확장을 떼어냈으므로(500 회피), 메시지의 from/to 에서 도출한다.
        // 1) 인바운드 메시지의 from(내가 아닌 사람), 2) 없으면 아웃바운드 메시지의 to.
        let other = conv.participants?.data?.find((p) => p.id !== account.igUserId);
        if (!other) {
          for (const m of messages) {
            if (m.from && m.from.id !== account.igUserId) {
              other = m.from;
              break;
            }
            const toOther = m.to?.data?.find((t) => t.id !== account.igUserId);
            if (toOther) {
              other = toOther;
              break;
            }
          }
        }

        for (const m of messages) {
          if (!m.message) {
            skipped++;
            continue; // 텍스트 없는 메시지(이미지 등)는 일단 스킵
          }

          const isOut = m.from.id === account.igUserId;
          const payload: IngestPayload = {
            brand: account.brand,
            channel: "ig_dm",
            externalThreadId: conv.id,
            externalMessageId: m.id,
            customerHandle: other?.username ?? undefined,
            customerName: other?.name ?? other?.username ?? undefined,
            subject: `@${other?.username ?? "IG"} DM`,
            bodyText: m.message,
            sentAt: new Date(m.created_time),
            direction: isOut ? "out" : "in",
            raw: m as unknown,
          };

          const result = await ingestMessage(payload);
          if (result.inserted) inserted++;
          else skipped++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${account.brand}/${account.displayName}: ${msg}`);
    }
  }

  return { accounts: accounts.length, inserted, skipped, errors };
}

export async function syncSingleIgAccount(account: IgAccount) {
  // 단일 계정 동기화 (향후 webhook 대응용)
  return account;
}
