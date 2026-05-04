/**
 * CS 인박스 텔레그램 알림 사전 필터.
 *
 * Gmail 채널만 AI 분류로 마케팅·뉴스레터·자동알림을 알림에서 제외.
 * 다른 채널(Crisp/Instagram/Threads/카카오 상담톡 등)은 직접 채팅이라 항상 알림.
 *
 * 분류 결과는 thread.id 기준으로 last_message_at 과 함께 캐시 — 같은 메시지를
 * 매 cron 마다 재분류하지 않음. 새 메시지가 오면 last_message_at 이 갱신되어
 * 자동 재분류.
 *
 * AI 미설정/실패 시 fail-open (알림 발송) — 진짜 고객 문의를 놓치는 게
 * 마케팅 알림 한두 개 받는 것보다 위험.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getCsSupabase } from "./store";
import type { CsThread } from "./types";

const MODEL = "claude-haiku-4-5";
const CACHE_PREFIX = "cs_notify_classify:";

interface CachedClassification {
  needsReply:    boolean;
  reason:        string;
  /** 분류 시점의 thread.last_message_at — 새 메시지가 오면 캐시 무효화 */
  classifiedFor: string;
  classifiedAt:  string;
}

const SYSTEM_PROMPT = `역할: 폴바이스/해리엇 시계 브랜드의 고객문의(CS) 인박스에서 텔레그램 알림 대상인지 분류.

needsReply=true (알림 보냄):
- 실제 고객 문의 (주문/배송/환불/AS/상품/각인 등)
- 비즈니스 협업·거래 제안 (입점, MD/PD 미팅, 리테일 파트너, 인플루언서 컬랩)
- 거래처/파트너의 회신 필요 메시지
- 정부/행정 회신 필요 안내 (세금·인증·보험 등)

needsReply=false (알림 안 보냄, 인박스 표시는 유지):
- 마케팅·광고 영업 메일 (예: "광고팀입니다", "캠페인 제안", "메가 페이백", "프로모션 안내")
- 뉴스레터, 정기 안내, 정기구독 발송
- 자동화 알림 (영수증, 세금계산서, 결제·배송 알림, 인증번호)
- 단순 정보 공유 / 공지 / FYI

응답: 반드시 JSON 한 줄만 (코드블록/설명 없이): {"needsReply": true|false, "reason": "한국어 한 줄"}`;

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

async function getCached(threadId: string): Promise<CachedClassification | null> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", `${CACHE_PREFIX}${threadId}`)
    .maybeSingle();
  return (data?.data as CachedClassification | null) ?? null;
}

async function setCached(threadId: string, result: CachedClassification): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").upsert(
    {
      key: `${CACHE_PREFIX}${threadId}`,
      data: result,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

async function classifyOne(thread: CsThread): Promise<CachedClassification> {
  const client = getClient();
  const now = new Date().toISOString();
  if (!client) {
    return {
      needsReply:    true,
      reason:        "AI 미설정 — fail-open",
      classifiedFor: thread.last_message_at,
      classifiedAt:  now,
    };
  }

  const userMsg = [
    `브랜드: ${thread.brand}`,
    `채널: ${thread.channel}`,
    `발신: ${thread.customer_name ?? thread.customer_handle ?? "?"}`,
    `제목: ${thread.subject ?? "(없음)"}`,
    `미리보기: ${thread.last_message_preview?.slice(0, 500) ?? "(없음)"}`,
  ].join("\n");

  try {
    const res = await client.messages.create({
      model:      MODEL,
      max_tokens: 150,
      system: [
        {
          type:          "text",
          text:          SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }, // 같은 cron 내 다중 분류 시 시스템 프롬프트 재사용
        },
      ],
      messages: [{ role: "user", content: userMsg }],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`JSON 추출 실패: ${text.slice(0, 200)}`);
    const parsed = JSON.parse(m[0]) as { needsReply?: boolean; reason?: string };
    return {
      needsReply:    !!parsed.needsReply,
      reason:        String(parsed.reason ?? "").slice(0, 200),
      classifiedFor: thread.last_message_at,
      classifiedAt:  now,
    };
  } catch (e) {
    console.error(
      "[cs-notify-filter] 분류 실패, fail-open:",
      e instanceof Error ? e.message : String(e),
    );
    return {
      needsReply:    true,
      reason:        "AI 분류 실패 — fail-open",
      classifiedFor: thread.last_message_at,
      classifiedAt:  now,
    };
  }
}

/**
 * 텔레그램 알림 대상인지 판정.
 * - Gmail 외 채널: 무조건 true
 * - Gmail: 캐시 hit 시 즉시 반환, miss 시 Claude Haiku 로 분류 후 캐시
 */
export async function shouldNotifyByAI(thread: CsThread): Promise<{
  notify: boolean;
  reason: string;
}> {
  if (thread.channel !== "gmail") {
    return { notify: true, reason: `${thread.channel} 채널 — 필터 미적용` };
  }

  const cached = await getCached(thread.id);
  if (cached && cached.classifiedFor === thread.last_message_at) {
    return { notify: cached.needsReply, reason: cached.reason };
  }

  const result = await classifyOne(thread);
  await setCached(thread.id, result);
  return { notify: result.needsReply, reason: result.reason };
}
