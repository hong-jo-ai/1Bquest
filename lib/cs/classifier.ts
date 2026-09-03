import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { getCsSupabase } from "./store";

/**
 * 2026-09-03: Gemini 2.5 Flash → Claude Haiku 4.5.
 * 무료 티어 한도(20요청)가 한 사이클 분류량보다 작아 **429 로 분류가 통째로 죽어 있었다.**
 * 탈락 38건이 전부 429였고 'CS 아님' 판정은 0건 — 고객 문의가 조용히 사라지고 있었다.
 * 레포의 다른 분류기(notifyFilter·inboxClassifier)와 같은 모델·계정으로 통일한다.
 * 물량 기준 월 $2 수준이라 무료 쿼터를 아낄 이유가 없다.
 */
const MODEL = "claude-haiku-4-5";
const BLACKLIST_KEY = "cs_sender_blacklist";
const NEGATIVES_KEY = "cs_classifier_negatives";
const MAX_NEGATIVES = 30; // 프롬프트 길이/예시 가치 균형

/**
 * CS가 절대 아닌 발신자 패턴 — LLM 호출 전에 즉시 차단.
 * gmailIngest와 cleanup 모두 사용.
 *
 * 두 종류:
 *   1. Gmail 프로토콜 / 시스템 발신 (mailer-daemon, noreply 등)
 *   2. 운영하면서 학습된 입점 플랫폼 / 광고 / 거래처 / 결제 도메인
 */
export const NON_CS_SENDER_PATTERNS: RegExp[] = [
  // 시스템·자동발송
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

  // 입점 플랫폼 / 광고 / 마케팅
  /@29cm\.co\.kr$/i,
  /@(qoo10|qoo10info|qoo10cs)\.jp$/i,
  /@musinsa\.com$/i,
  /@a-bly\.com$/i,
  /@intl\.paypal\.com$/i,
  /@message\.fedex\.com$/i,
  /@crosscert\.com$/i,
  /@300cbt\.com$/i,
  /@directsend61\.com$/i,
  /@wethemoment\.net$/i,
  /@keywordlab\.kr$/i,
  /@coceanchina\.com$/i,
  /@korcham\.net$/i,

  // 거래처 (CS 인박스에서 제외하기로 결정)
  /@fjord\.kr$/i,
];

/**
 * 발신자 헤더 또는 이메일이 NON-CS 패턴에 매칭되는지 확인.
 */
export function isNonCsSender(senderText: string | null | undefined): boolean {
  if (!senderText) return false;
  return NON_CS_SENDER_PATTERNS.some((r) => r.test(senderText));
}

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

/**
 * 사용자가 "CS 아님" 으로 마킹한 메일 사례 — 분류기 프롬프트에 주입해 학습.
 * 같은/유사한 메일이 다음에 들어오면 LLM 이 패턴 매칭으로 false 를 반환하게 한다.
 */
export interface ClassifierNegative {
  brand:     "paulvice" | "harriot";
  fromEmail: string | null;
  fromName:  string | null;
  subject:   string;
  snippet:   string;  // 본문 앞부분 (~200자)
  ts:        string;  // ISO
}

export async function getClassifierNegatives(): Promise<ClassifierNegative[]> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", NEGATIVES_KEY)
    .maybeSingle();
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data as ClassifierNegative[];
}

export async function addClassifierNegative(neg: ClassifierNegative): Promise<void> {
  const db = getCsSupabase();
  const current = await getClassifierNegatives();
  // 신규 항목을 맨 앞에. 같은 (brand, fromEmail, subject) 조합은 중복 제거.
  const dedupKey = (n: ClassifierNegative) =>
    `${n.brand}|${(n.fromEmail ?? "").toLowerCase()}|${n.subject.trim().slice(0, 80)}`;
  const targetKey = dedupKey(neg);
  const filtered = current.filter((c) => dedupKey(c) !== targetKey);
  const next = [neg, ...filtered].slice(0, MAX_NEGATIVES);
  await db
    .from("kv_store")
    .upsert(
      { key: NEGATIVES_KEY, data: next, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
}

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/** 응답 스키마를 서버가 강제한다 — 예전엔 텍스트에서 ```json 을 벗겨 파싱하다 실패할 수 있었다. */
const RESULT_SCHEMA = {
  type: "object",
  properties: {
    is_cs: { type: "boolean" },
    confidence: { type: "number" },
    category: {
      type: "string",
      enum: ["customer_inquiry", "order_notification", "marketing", "system", "newsletter", "other"],
    },
    reason: { type: "string" },
  },
  required: ["is_cs", "confidence", "category", "reason"],
  additionalProperties: false,
} as const;

/** 메일이 고객 문의인지 분류한다. 응답 스키마는 서버가 강제한다. */
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

  // 사용자가 과거에 "CS 아님" 으로 분류한 사례 — 같은 브랜드 것만 추려서 주입
  const allNegatives = await getClassifierNegatives();
  const brandNegatives = allNegatives.filter((n) => n.brand === input.brand).slice(0, 12);
  const negativesBlock = brandNegatives.length === 0
    ? ""
    : `\n\n중요 — 사용자가 과거에 "CS 아님"으로 학습시킨 사례들이다. 발신자/제목/본문 톤이 아래와 비슷하면 is_cs=false 로 분류하라:\n${
        brandNegatives.map((n, i) =>
          `${i + 1}. From: ${n.fromName ?? ""} <${n.fromEmail ?? ""}>\n   Subject: ${n.subject}\n   Body: ${n.snippet.slice(0, 200)}`
        ).join("\n")
      }`;

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

핵심 구분 기준: "내가 직접 답을 보내야 하는 사람의 메시지인가?" 자동발송 트랜잭션 알림은 답할 대상이 없으므로 모두 false.${negativesBlock}

confidence 는 0.0~1.0, reason 은 한 줄 판단 근거로 쓴다.`;

  try {
    // 프롬프트 앞부분(브랜드 지시문 + 학습사례)은 한 사이클에서 계속 같다 → 캐시로 재사용.
    // 뒤쪽(분류할 메일)만 매번 달라지도록 순서를 잡아 둔다.
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 300,
      system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `From: ${input.fromName ?? ""} <${input.fromEmail ?? ""}>\nSubject: ${input.subject}\nBody (요약): ${input.bodySnippet.slice(0, 500)}`,
        },
      ],
      output_config: { format: jsonSchemaOutputFormat(RESULT_SCHEMA) },
    });

    const out = res.parsed_output;
    if (!out) return fallback("응답 파싱 실패(parsed_output 없음)");
    return {
      isCs: !!out.is_cs,
      confidence: Number(out.confidence) || 0,
      category: out.category,
      reason: out.reason ?? "",
    };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
}

function fallback(reason: string): ClassifyResult {
  // 분류 실패(429 쿼터 등) 시 이번 사이클은 스킵 — dedup 마커가 안 남으므로 다음 시간 크론이 재분류한다.
  // (기존 '통과' 정책은 shong@ 백로그 버스트에서 뉴스레터·알림이 CS 인박스로 쏟아지는 사고를 냄 2026-07-19)
  return {
    isCs: false,
    confidence: 0,
    category: "other",
    reason: `분류 실패 → 스킵(다음 사이클 재시도): ${reason}`,
  };
}
