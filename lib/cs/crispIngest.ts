import { ingestMessage } from "./store";
import {
  extractTextContent,
  fetchCrispMessages,
  listCrispAccounts,
  listCrispConversations,
} from "./crispClient";
import type { IngestPayload } from "./types";

export async function syncAllCrispAccounts(): Promise<{
  accounts: number;
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const accounts = await listCrispAccounts();
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const conversations = await listCrispConversations(account, {
        perPage: 20,
        pages: 2,
      });

      for (const conv of conversations) {
        let messages;
        try {
          messages = await fetchCrispMessages(account, conv.session_id);
        } catch (e) {
          errors.push(
            `conv ${conv.session_id}: ${e instanceof Error ? e.message : String(e)}`
          );
          continue;
        }

        if (messages.length === 0) continue;

        const nickname = conv.meta?.nickname ?? null;
        const email = conv.meta?.email ?? null;

        // 시간순 정렬
        messages.sort((a, b) => a.timestamp - b.timestamp);

        for (const m of messages) {
          const isOut = m.from === "operator";
          const text = extractTextContent(m);
          if (!text) {
            skipped++;
            continue;
          }

          const payload: IngestPayload = {
            brand: account.brand,
            channel: "crisp",
            externalThreadId: conv.session_id,
            externalMessageId: `${conv.session_id}:${m.fingerprint}`,
            customerHandle: email ?? undefined,
            customerName: nickname ?? undefined,
            subject: nickname ?? email ?? "Crisp 대화",
            bodyText: text,
            sentAt: new Date(m.timestamp),
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
