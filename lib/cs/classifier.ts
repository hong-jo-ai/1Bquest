import Anthropic from "@anthropic-ai/sdk";
import { getCsSupabase } from "./store";

const MODEL = "claude-haiku-4-5-20251001";
const BLACKLIST_KEY = "cs_sender_blacklist";

export interface ClassifyInput {
  brand: "paulvice" | "harriot";
  fromName: string | null;
  fromEmail: string | null;
  subject: string;
  bodySnippet: string;
}

export interface ClassifyResult {
  isCs: boolean;
  confidence: number;
  category:
    | "customer_inquiry"
    | "order_notification"
    | "marketing"
    | "system"
    | "newsletter"
    | "other";
  reason: string;
}

/**
 * 사용자가 학습시킨 송신자 차단 목록을 가져온다.
 * 정확 매칭(이메일) 또는 도메인 매칭(@example.com).
 */
export async function getSenderBlacklist(): Promise<string[]> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", BLACKLIST_KEY)
    .maybeSingle();
  if (!data?.data) return [];
  if (Array.isArray(data.data)) return data.data as string[];
  return [];
}

export async function addToSenderBlacklist(sender: string): Promise<void> {
  const db = getCsSupabase();
  const current = await getSenderBlacklist();
  if (current.includes(sender)) return;
  const next = [...current, sender];
  await db
    .from("kv_store")
    .upsert(
      { key: BLACKLIST_KEY, data: next, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
}

export function isBlacklisted(
  email: string | null,
  blacklist: string[]
): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  for (const entry of blacklist) {
    const e = entry.toLowerCase();
    if (e === lower) return true;
    if (e.startsWith("@") && lower.endsWith(e)) return true;
  }
  return false;
}

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/**
 * Haiku로 메일이 고객 문의인지 분류한다.
 * 빠르고 저렴 (입력 ~500자, 출력 ~50자).
 */
export async function classifyEmail(
  input: ClassifyInput
): Promise<ClassifyResult> {
  const client = getClient();
  if (!client) {
    // API 키 없으면 기본적으로 통과시킴 (수동 분류 모드)
    return {
      isCs: true,
      confidence: 0,
      category: "other",
      reason: "ANTHROPIC_API_KEY 미설정 — 분류 생략",
    };
  }

  const brandLabel = input.brand === "paulvice" ? "폴바이스 (PAULVICE) - 여성 시계 브랜드" : "해리엇 (HARRIOT) - 한국 프리미엄 시계 브랜드";

  const prompt = `너는 ${brandLabel}의 고객 CS 인박스 분류기다. 받은 이메일이 "고객 문의"인지 판별하라.

고객 문의 예시:
- 제품 관련 질문 (사이즈, 색상, 재고, 가격)
- AS, 수리, 환불, 교환 요청
- 배송 문의
- 주문 변경/취소 요청
- 각인, 선물 포장 등 옵션 문의
- 일반 사용자가 직접 작성한 이메일

고객 문의가 아닌 것:
- 카페24/식스샵/네이버페이/카카오페이 등 플랫폼의 자동 주문 알림
- 마케팅·뉴스레터·광고
- 결제·은행·카드 알림
- Google·Meta·Apple 등 시스템 알림
- 자동 회신, no-reply 발신
- 채용 문의, 협업·제휴 제안 (이건 CS 아님)
- 재고 알림, 가격 비교 사이트 알림

응답은 반드시 아래 JSON 형식만:
{
  "is_cs": true 또는 false,
  "confidence": 0.0~1.0,
  "category": "customer_inquiry" | "order_notification" | "marketing" | "system" | "newsletter" | "other",
  "reason": "한 줄 판단 근거"
}

---

분류할 이메일:
From: ${input.fromName ?? ""} <${input.fromEmail ?? ""}>
Subject: ${input.subject}
Body (요약): ${input.bodySnippet.slice(0, 500)}`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content.find((c) => c.type === "text");
    if (!block || block.type !== "text") {
      return fallback("text 블록 없음");
    }
    const cleaned = block.text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as {
      is_cs: boolean;
      confidence: number;
      category: ClassifyResult["category"];
      reason: string;
    };
    return {
      isCs: !!parsed.is_cs,
      confidence: Number(parsed.confidence) || 0,
      category: parsed.category ?? "other",
      reason: parsed.reason ?? "",
    };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
}

function fallback(reason: string): ClassifyResult {
  // 분류 실패 시 보수적으로 통과 (놓치는 것보다 노이즈가 낫다)
  return {
    isCs: true,
    confidence: 0,
    category: "other",
    reason: `분류 실패 → 통과: ${reason}`,
  };
}
