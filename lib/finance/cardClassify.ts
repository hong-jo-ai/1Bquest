/**
 * PG 경유 카드결제 실시간 분류 — 가맹점이 PG(헥토파이낸셜/네이버파이낸셜 등)로 가려진 건은
 * 우리카드 SMS 수집 즉시 사장님께 텔레그램으로 "이거 뭐였어?" 물어보고, 답장으로 분류한다.
 * (시간 지나면 기억 안 나므로 실시간 처리)
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { categorizeMerchant, type TxCategory } from "./categorize";

// 실제 가맹점이 가려지는 PG/간편결제 패턴 (텔레그램 문의 대상).
// 네이버페이/네이버파이낸셜은 enrich-npay(메일 보강)가 자동 처리하므로 제외(중복 문의 방지).
const PG_RE = /헥토파이낸셜|NICE\s*\(?빌링|토스페이|비바리퍼블리카|카카오페이|페이코|payco|KCP|이니시스|스마트로|다날|인터넷상거래|온라인상거래|간편결제|페이히어|세틀뱅크/i;

export const EXPENSE_CATEGORIES: TxCategory[] = [
  "매입", "부자재", "사무용품", "비품/설비", "복리후생", "광고비", "소프트웨어",
  "통신비", "임대료", "택배비", "여비교통비", "수수료", "세금", "보험료", "수선비",
  "도서인쇄", "식비", "교통/연료", "접대비", "개인", "기타",
];

export function isPgMerchant(m: string): boolean {
  return PG_RE.test(m || "");
}

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

interface Pending {
  id: string; // finance_card_usage id
  pgMerchant: string;
  amount: number;
  date: string;
  chatId: number | string;
  askedAt: string;
}

/** PG 결제 1건을 분류 대기열에 등록. */
export async function enqueueCardClassify(u: { id: string; merchant: string; amount: number; use_date: string }, chatId: number | string): Promise<void> {
  const data: Pending = { id: u.id, pgMerchant: u.merchant, amount: u.amount, date: u.use_date, chatId, askedAt: new Date().toISOString() };
  await sb().from("kv_store").upsert({ key: `card_classify:${u.id}`, data, updated_at: data.askedAt }, { onConflict: "key" });
}

/** 대기 중인 분류 요청이 있는지(가장 오래된 것 반환). */
async function oldestPending(): Promise<{ key: string; data: Pending } | null> {
  const { data } = await sb().from("kv_store").select("key,data").like("key", "card_classify:%");
  const list = (data ?? []).filter((r) => r.data && (r.data as Pending).id).sort((a, b) => String((a.data as Pending).askedAt).localeCompare(String((b.data as Pending).askedAt)));
  return list[0] ? { key: list[0].key, data: list[0].data as Pending } : null;
}

export async function hasPendingClassify(): Promise<boolean> {
  return (await oldestPending()) !== null;
}

// 설명 → 분류 (AI). 실패 시 룰 기반, 그래도 안 되면 기타.
async function aiCategory(desc: string): Promise<TxCategory> {
  const rule = categorizeMerchant(desc);
  if (rule !== "기타") return rule;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "기타";
  try {
    const client = new Anthropic({ apiKey: key });
    const r = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16,
      messages: [{ role: "user", content: `개인사업자 카드결제 설명을 아래 분류 중 하나로만 답하세요(분류명 한 단어만, 설명·기호 없이).\n분류: ${EXPENSE_CATEGORIES.join(", ")}\n\n설명: ${desc}\n분류:` }],
    });
    const out = (r.content.find((c) => c.type === "text") as { text?: string } | undefined)?.text?.trim() ?? "";
    const hit = EXPENSE_CATEGORIES.find((c) => out.includes(c));
    return hit ?? "기타";
  } catch {
    return "기타";
  }
}

/**
 * 사장님 답장으로 가장 오래된 대기건을 분류.
 * 답장 형식: "뱀부랩 필라멘트" 또는 "뱀부랩 필라멘트 / 부자재"(분류 직접 지정).
 * 반환: 처리 요약 또는 null(대기건 없음).
 */
export async function applyCardClassify(reply: string): Promise<{ merchant: string; category: TxCategory; amount: number } | null> {
  const p = await oldestPending();
  if (!p) return null;
  let merchant = reply.trim();
  let category: TxCategory | null = null;
  const m = reply.split(/[\/|]/);
  if (m.length >= 2) {
    merchant = m[0].trim();
    const c = m[1].trim();
    category = EXPENSE_CATEGORIES.find((x) => x === c) ?? null;
  }
  if (!category) category = await aiCategory(merchant);

  const db = sb();
  const { data: row } = await db.from("finance_card_usage").select("raw").eq("id", p.data.id).maybeSingle();
  const raw = (row?.raw as Record<string, unknown> | null) ?? {};
  await db.from("finance_card_usage").update({
    merchant: `${merchant} (${p.data.pgMerchant})`,
    category,
    category_source: "manual",
    raw: { ...raw, pgMemo: merchant, pgMerchant: p.data.pgMerchant },
  }).eq("id", p.data.id);
  await db.from("kv_store").delete().eq("key", p.key);
  return { merchant, category, amount: p.data.amount };
}
