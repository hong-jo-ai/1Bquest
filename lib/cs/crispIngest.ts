import { getThreadLastMessageMap, ingestMessage, refreshThreadCustomer } from "./store";
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
  unchanged: number;
  errors: string[];
}> {
  const accounts = await listCrispAccounts();
  let inserted = 0;
  let skipped = 0;
  let unchanged = 0;
  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const conversations = await listCrispConversations(account, {
        perPage: 20,
        pages: 2,
      });

      // 증분 동기화: 이미 가진 마지막 메시지 시각과 비교해, 변경 없는 대화는
      // 메시지 조회(Crisp API 호출)를 생략한다. 매 실행 전량 재조회로 plugin
      // 토큰 쿼터가 소진돼 429(rate_limited)로 인제스트가 멈추던 문제 해결.
      const lastSeen = await getThreadLastMessageMap(
        "crisp",
        conversations.map((c) => c.session_id)
      );

      for (const conv of conversations) {
        const seenAt = lastSeen.get(conv.session_id);
        let convUpdated = conv.updated_at ?? conv.created_at ?? 0;
        // Crisp는 ms 타임스탬프지만, 초 단위로 오면 전부 seenAt 미만이 되어
        // 모든 대화를 건너뛰는 회귀가 생긴다 → ms로 정규화.
        if (convUpdated > 0 && convUpdated < 1e12) convUpdated *= 1000;
        if (seenAt !== undefined && convUpdated > 0 && convUpdated <= seenAt) {
          unchanged++;
          continue;
        }

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

        // 답장으로 지워진 고객 정보 보충 (dup 메시지여도 스레드 갱신)
        if (nickname || email) {
          await refreshThreadCustomer("crisp", conv.session_id, {
            handle: email,
            name: nickname,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${account.brand}/${account.displayName}: ${msg}`);
    }
  }

  return { accounts: accounts.length, inserted, skipped, unchanged, errors };
}
