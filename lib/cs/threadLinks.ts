/**
 * 같은 고객의 다른 대화를 **채널을 가로질러** 찾는다.
 *
 * 왜 필요한가 (2026-09-15 사고): 손정원 고객이 같은 주문(설월)으로 웹챗과 스마트스토어에
 * 같은 질문을 넣었다. 컨텍스트 라우트가 `customer_handle` 완전일치로만 묶어서
 * (웹챗=전화번호, 스마트스토어=`wint***` 마스킹) 두 건이 별개로 보였고, 웹챗에 이미
 * 답한 걸 모른 채 스마트스토어로 또 답했다.
 *
 * 매칭 근거 3종 — 하나라도 맞으면 묶되, **어떤 근거로 묶였는지 남긴다**(사장님 결정 2026-09-15):
 *   order        주문번호 일치. 본문·raw 에서 추출. 확실.
 *   phone/email  연락처 일치. 채널마다 형식이 달라 정규화 후 비교. 확실.
 *   name_product 이름 + 상품이 같을 때만. 이름만으로는 동명이인이 섞여 묶지 않는다.
 *                마스킹 이름(손*원)도 패턴으로 비교한다 — 스마트스토어는 항상 마스킹이다.
 *
 * ⚠️ 주문번호 패턴은 **엄격하게만** 잡는다. 9자리 숫자(무신사 주문번호 형식)까지 잡으면
 *    W컨셉 상품코드(307951780)·29CM 기획전 번호·광고메일 숫자가 전부 걸려 MD 메일을
 *    같은 고객으로 묶는다(실측 2026-09-15). 무신사는 포기한다.
 */
import { getCsSupabase, getThread } from "./store";
import { normalizePhone } from "./customerOrders";
import type { CsBrandId, CsChannel, CsMessage, CsStatus, CsThread } from "./types";

export type LinkReason = "order" | "phone" | "email" | "name_product";

export interface LinkedThread {
  id: string;
  brand: CsBrandId;
  channel: CsChannel;
  subject: string | null;
  last_message_at: string;
  status: CsStatus;
  last_message_preview: string | null;
  created_at: string;
  matchedBy: LinkReason[];
}

export interface CrossChannelHit {
  id: string;
  channel: CsChannel;
  at: string;
}

/** 답장 전에 봐야 할 것 — 다른 대화에 이미 답이 나갔거나, 미답변이 따로 있거나. */
export interface CrossChannelSummary {
  /** 최근 7일 안에 out 메시지가 있는 다른 대화 (이미 답변됨 → 중복 응대 위험) */
  answeredElsewhere: CrossChannelHit[];
  /** status 가 unanswered 인 다른 대화 */
  unansweredElsewhere: CrossChannelHit[];
}

// 카페24 20260911-0000192 · 29CM ORD20260913-6287246 · 네이버 2026091491136931(16자리)
const ORDER_RE = /\bORD20\d{6}-\d{7}\b|\b20\d{6}-\d{7}\b|\b20\d{12,14}\b/g;

// 상품은 번호로 못 맞춘다 — 스마트스토어 productNo 와 카페24 product_no 가 다르다.
// 모델 키워드로 정규화한다. 이름 매칭과 AND 로만 쓰이므로 일반어 오탐(기원=wish, 도보=walk)은 감수한다.
const MODEL_KEYS: Array<[string, RegExp]> = [
  ["seolwol", /설월|seolwol/i],
  ["kiwon", /기원|ki[:\s-]?won/i],
  ["seongsan", /성산|seongsan/i],
  ["seohae", /서해|seohae/i],
  ["gwangan", /광안|gwangan/i],
  ["gayang", /가양|gayang/i],
  ["ilgu", /일구|ilgu/i],
  ["dobo", /도보|dobo/i],
  ["kari", /카리|kari/i],
  ["eclat", /에끌라|eclat/i],
  ["audrey", /오드리|audrey/i],
  ["miniel", /미니엘|miniel/i],
  ["kelly", /켈리|kelly/i],
  ["jacqueline", /잭클린|jacqueline/i],
];

export function extractOrderNumbers(texts: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of String(t).matchAll(ORDER_RE)) out.add(m[0]);
  }
  return [...out];
}

/** 텍스트 목록을 앞에서부터 훑어 처음 걸리는 모델 키를 돌려준다(우선순위 = 배열 순서). */
export function productKeyOf(texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    if (!t) continue;
    for (const [key, re] of MODEL_KEYS) if (re.test(String(t))) return key;
  }
  return null;
}

function normName(s: string | null | undefined): string {
  return String(s ?? "").replace(/\s+/g, "").trim();
}

/** 공백 제거 후 완전일치, 또는 마스킹(`*`) 패턴 일치. 마스킹 쪽에 실제 글자가 2자 이상 있어야 한다. */
export function nameMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (!x.includes("*") && !y.includes("*")) return false;
  if (x.length !== y.length) return false;
  let known = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === "*" || y[i] === "*") continue;
    if (x[i] !== y[i]) return false;
    known++;
  }
  return known >= 2;
}

/** 메시지 묶음에서 주문번호·상품 단서로 쓸 텍스트를 모은다(raw 는 문자열화). */
function signalTexts(thread: Pick<CsThread, "subject">, messages: CsMessage[]): {
  orderTexts: string[];
  productTexts: string[];
} {
  const orderTexts: string[] = [];
  const productTexts: string[] = [];
  for (const m of messages) {
    if (m.direction !== "in") continue;
    const raw = (m.raw ?? {}) as Record<string, unknown>;
    const inquiry = (raw.inquiry ?? raw.qna ?? {}) as Record<string, unknown>;
    // 스마트스토어: raw.inquiry(1:1)·raw.qna(상품 Q&A).productName 이 가장 정확한 상품 단서
    if (typeof inquiry.productName === "string") productTexts.push(inquiry.productName);
    // 웹챗: 문의한 페이지 URL 의 slug(/product/harriot-kiwon-jade/122/)
    if (typeof raw.page_url === "string") productTexts.push(raw.page_url);
    orderTexts.push(m.body_text ?? "", JSON.stringify(raw));
    productTexts.push(m.body_text ?? "");
  }
  productTexts.push(thread.subject ?? "");
  return { orderTexts, productTexts };
}

function isEmail(s: string | null | undefined): boolean {
  return /@/.test(String(s ?? ""));
}

/**
 * 스레드 하나를 기준으로 같은 고객의 다른 대화를 찾는다.
 * 후보는 최근 365일 스레드 전체(≈1천 건)를 받아 앱에서 비교한다 — 마스킹 이름 매칭은 SQL 로 못 쓴다.
 */
export async function findLinkedThreads(threadId: string): Promise<{
  related: LinkedThread[];
  crossChannel: CrossChannelSummary;
}> {
  const empty = { related: [], crossChannel: { answeredElsewhere: [], unansweredElsewhere: [] } };
  const data = await getThread(threadId);
  if (!data) return empty;
  const { thread, messages } = data;
  const db = getCsSupabase();

  // ── 기준 스레드의 신호
  const phone = normalizePhone(thread.customer_handle);
  const email = isEmail(thread.customer_handle) ? String(thread.customer_handle).toLowerCase() : null;
  const { orderTexts, productTexts } = signalTexts(thread, messages);
  const orderNos = extractOrderNumbers(orderTexts).slice(0, 5);
  const productKey = productKeyOf(productTexts);
  const name = normName(thread.customer_name);

  // ── 주문번호로 먼저: 본문에 그 번호가 있는 메시지의 thread_id (스마트스토어는 buildBody 가 "주문: N" 을 본문에 넣는다)
  const orderThreadIds = new Set<string>();
  for (const no of orderNos) {
    const { data: rows } = await db
      .from("cs_messages")
      .select("thread_id")
      .ilike("body_text", `%${no}%`)
      .neq("thread_id", threadId)
      .limit(50);
    for (const r of rows ?? []) orderThreadIds.add(r.thread_id as string);
  }

  // ── 후보 풀: 최근 365일 (⚠️ Supabase 는 1000행에서 조용히 잘린다 → range 페이지네이션)
  const since = new Date(Date.now() - 365 * 86400000).toISOString();
  const candidates: Array<Pick<CsThread,
    "id" | "brand" | "channel" | "customer_handle" | "customer_name" | "subject" |
    "last_message_at" | "status" | "last_message_preview" | "created_at">> = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data: rows } = await db
      .from("cs_threads")
      .select("id, brand, channel, customer_handle, customer_name, subject, last_message_at, status, last_message_preview, created_at")
      .gte("last_message_at", since)
      .neq("id", threadId)
      .order("last_message_at", { ascending: false })
      .range(from, from + 999);
    candidates.push(...(rows ?? []));
    if (!rows || rows.length < 1000) break;
  }

  // ── 1차 판정 (주문번호·연락처·이름) — 이름은 상품까지 맞아야 확정되므로 보류 목록에 둔다
  const related = new Map<string, LinkedThread>();
  const nameOnly: typeof candidates = [];
  const add = (c: (typeof candidates)[number], reason: LinkReason) => {
    const cur = related.get(c.id);
    if (cur) { if (!cur.matchedBy.includes(reason)) cur.matchedBy.push(reason); return; }
    related.set(c.id, {
      id: c.id, brand: c.brand, channel: c.channel, subject: c.subject,
      last_message_at: c.last_message_at, status: c.status,
      last_message_preview: c.last_message_preview, created_at: c.created_at,
      matchedBy: [reason],
    });
  };
  for (const c of candidates) {
    if (orderThreadIds.has(c.id)) add(c, "order");
    if (phone && normalizePhone(c.customer_handle) === phone) add(c, "phone");
    if (email && isEmail(c.customer_handle) && String(c.customer_handle).toLowerCase() === email) add(c, "email");
    if (name && productKey && nameMatches(name, c.customer_name)) nameOnly.push(c);
  }

  // ── 이름+상품: 이름이 맞은 후보(소수)만 메시지를 읽어 상품 키를 비교한다
  const pending = nameOnly.filter((c) => !related.has(c.id)).slice(0, 20);
  if (pending.length) {
    const { data: msgs } = await db
      .from("cs_messages")
      .select("thread_id, direction, body_text, raw, sent_at")
      .in("thread_id", pending.map((c) => c.id))
      .order("sent_at", { ascending: true });
    const byThread = new Map<string, CsMessage[]>();
    for (const m of (msgs ?? []) as CsMessage[]) {
      const arr = byThread.get(m.thread_id) ?? [];
      if (arr.length < 6) arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    for (const c of pending) {
      const { productTexts: pt } = signalTexts(c, byThread.get(c.id) ?? []);
      if (productKeyOf(pt) === productKey) add(c, "name_product");
    }
  }

  const list = [...related.values()]
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
    .slice(0, 20);

  // ── 답장 전 경고 재료: 다른 대화의 최근 out / 미답변
  const cross: CrossChannelSummary = { answeredElsewhere: [], unansweredElsewhere: [] };
  if (list.length) {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: outs } = await db
      .from("cs_messages")
      .select("thread_id, sent_at")
      .in("thread_id", list.map((r) => r.id))
      .eq("direction", "out")
      .gte("sent_at", weekAgo)
      .order("sent_at", { ascending: false });
    const latestOut = new Map<string, string>();
    for (const o of outs ?? []) if (!latestOut.has(o.thread_id)) latestOut.set(o.thread_id, o.sent_at);
    for (const r of list) {
      const at = latestOut.get(r.id);
      if (at) cross.answeredElsewhere.push({ id: r.id, channel: r.channel, at });
      if (r.status === "unanswered") cross.unansweredElsewhere.push({ id: r.id, channel: r.channel, at: r.last_message_at });
    }
  }

  return { related: list, crossChannel: cross };
}
