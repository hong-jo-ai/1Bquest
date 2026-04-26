import { GoogleGenAI } from "@google/genai";
import { getCsSupabase } from "./store";

const MODEL = "gemini-2.5-flash";
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

let cachedClient: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
}

/**
 * Gemini Flash로 메일이 고객 문의인지 분류한다.
 * 빠르고 저렴 (free tier 내에서 무료 운영 가능).
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
      reason: "GEMINI_API_KEY 미설정 — 분류 생략",
    };
  }

  const brandLabel = input.brand === "paulvice" ? "폴바이스 (PAULVICE) - 여성 시계 브랜드" : "해리엇 (HARRIOT) - 한국 프리미엄 시계 브랜드";

  const prompt = `너는 ${brandLabel}의 고객 CS 인박스 분류기다. 받은 이메일이 "내가 응답해야 할 고객 문의"인지 판별하라.

고객 문의 (is_cs=true) 예시:
- 일반 고객이 직접 작성한 이메일 (제품 질문, AS, 환불, 교환, 배송, 주문 변경, 각인 등)
- **카페24/식스샵 게시판에 고객이 글/문의를 올렸다는 알림** — 예: "[관리자] 새 게시글이 등록되었습니다", "1:1 문의가 등록되었습니다", "상품 Q&A가 등록되었습니다", "리뷰가 등록되었습니다 (부정적인 경우)"
- 고객이 직접 회신/연락한 모든 사람 메시지

고객 문의가 아님 (is_cs=false) 예시:
- **카페24/식스샵 주문/배송/결제/회원 알림** — 예: "주문이 접수되었습니다", "발송 완료", "결제 완료", "회원가입을 환영합니다", "포인트 적립", "출고 완료", "배송 시작" 같은 트랜잭션 알림 → 모두 false
- 마케팅·뉴스레터·광고·프로모션 메일
- 은행·카드·페이 결제 알림
- Google·Meta·Apple·Vercel·Supabase 등 시스템/플랫폼 알림
- 자동 회신, no-reply 발신
- 채용 문의, 협업·제휴·광고 제안 (CS 아님)
- 재고 알림, 가격 비교 사이트 알림, 정산 알림

핵심 구분 기준: "내가 직접 답을 보내야 하는 사람의 메시지인가?" 자동발송 트랜잭션 알림은 답할 대상이 없으므로 모두 false.

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
    const res = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 300,
        // Gemini 2.5 Flash는 기본적으로 thinking 토큰을 소비하는데
        // 분류처럼 추론 깊이가 거의 필요없는 작업은 비활성화해야 출력 토큰이 살아남음
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const text = res.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      return fallback("Gemini 응답 비어있음");
    }
    const cleaned = text
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
