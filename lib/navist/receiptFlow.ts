/**
 * 나비스트 주얼리 입고 자동처리 — 텔레그램 거래명세서 사진 → 비전 판독 → 확인카드 → 기록 + 카페24 재고반영.
 *  1) extractNavistReceipt: 명세서 사진에서 제품·수량·단가 추출 (발주 매칭 없음, 명세 그대로)
 *  2) stageNavistPending: SKU 맵으로 각 제품 매핑 해석 → 확인카드(미매핑 표시). navist:pending:latest 포인터.
 *  3) applyMapping: 확인카드에 "2=195" 답장 → 제품명↔SKU 학습 + pending 갱신(다음부터 자동)
 *  4) confirmNavistPending: 입고 원장 기록 + 매핑된 제품만 카페24 재고 +수량
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  getSkuMap, setSkuEntry, addReceipt, normName,
  type Cafe24Ref, type NavistReceiptItem,
} from "@/lib/navist/store";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface NavistPendingItem extends NavistReceiptItem {
  sku?: Cafe24Ref | null;
}
export interface NavistPending {
  id: string; vendor: string; date?: string;
  items: NavistPendingItem[]; total?: number; at: string;
}

function kv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
const pendKey = (id: string) => `navist:pending:${id}`;
const LATEST = "navist:pending:latest";

async function savePending(p: NavistPending): Promise<void> {
  const sb = kv(); if (!sb) return;
  const now = new Date().toISOString();
  await sb.from("kv_store").upsert([
    { key: pendKey(p.id), data: p, updated_at: now },
    { key: LATEST, data: { id: p.id }, updated_at: now },
  ], { onConflict: "key" });
}
export async function loadNavistPending(id: string): Promise<NavistPending | null> {
  const sb = kv(); if (!sb) return null;
  const { data } = await sb.from("kv_store").select("data").eq("key", pendKey(id)).maybeSingle();
  return (data?.data as NavistPending) ?? null;
}
export async function getLatestPending(): Promise<NavistPending | null> {
  const sb = kv(); if (!sb) return null;
  const { data } = await sb.from("kv_store").select("data").eq("key", LATEST).maybeSingle();
  const id = (data?.data as { id?: string })?.id;
  return id ? loadNavistPending(id) : null;
}
async function deletePending(id: string): Promise<void> {
  const sb = kv(); if (!sb) return;
  await sb.from("kv_store").delete().eq("key", pendKey(id));
  const { data } = await sb.from("kv_store").select("data").eq("key", LATEST).maybeSingle();
  if ((data?.data as { id?: string })?.id === id) {
    await sb.from("kv_store").delete().eq("key", LATEST);
  }
}

const RECEIPT_TOOL = {
  name: "record_navist_receipt",
  description:
    "주얼리 공급처 (주)나비스트(NABIST)가 준 거래명세서 사진에서 제품별 입고 수량·단가를 추출합니다. " +
    "표의 각 행(제품명·단가·수량·합계)을 보이는 그대로 읽으세요. 숫자를 추측하지 말 것.",
  input_schema: {
    type: "object" as const,
    properties: {
      vendor: { type: "string", description: "공급처명. 명세서 상단/도장. 보통 '(주)나비스트'." },
      date: { type: "string", description: "명세서 날짜(YYYY-MM-DD). 없으면 생략." },
      items: {
        type: "array",
        description: "제품별 입고 행. 명세서에 적힌 순서대로.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "제품명 (예: 큐빅 싱글라인 테니스팔찌)" },
            qty: { type: "number", description: "입고 수량(정수)" },
            unitPrice: { type: "number", description: "단가(원). 없으면 생략." },
            amount: { type: "number", description: "합계 금액(원). 없으면 생략." },
          },
          required: ["name", "qty"],
        },
      },
      total: { type: "number", description: "총 합계 금액(원). 없으면 생략." },
    },
    required: ["items"],
  },
};

export interface ExtractedNavist {
  vendor?: string; date?: string; total?: number;
  items: NavistReceiptItem[];
}

/** 명세서 사진 판독 → 제품·수량·단가 */
export async function extractNavistReceipt(
  imageData: { data: string; mediaType: ImageMediaType },
): Promise<{ receipt: ExtractedNavist | null; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { receipt: null, error: "ANTHROPIC_API_KEY 미설정" };

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system:
      "너는 주얼리 공급처(나비스트) 거래명세서를 판독하는 도우미다. 표의 제품명·단가·수량·합계를 " +
      "정확히 읽어 record_navist_receipt 도구로 정확히 한 번 호출한다. 숫자는 보이는 대로, 추측 금지.",
    tools: [{ name: RECEIPT_TOOL.name, description: RECEIPT_TOOL.description, input_schema: RECEIPT_TOOL.input_schema as unknown as Anthropic.Tool["input_schema"] }],
    tool_choice: { type: "any" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.data } },
        { type: "text", text: "위 (주)나비스트 거래명세서를 읽고 record_navist_receipt를 호출하세요." },
      ],
    }],
  });
  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!tu) return { receipt: null, error: "판독 실패(도구 미호출)" };
  const inp = tu.input as ExtractedNavist;
  if (!inp.items?.length) return { receipt: null, error: "제품 행을 읽지 못함" };
  return { receipt: inp };
}

/** pending 저장 + SKU 맵으로 매핑 해석. */
export async function stageNavistPending(r: ExtractedNavist): Promise<NavistPending> {
  const map = await getSkuMap();
  const items: NavistPendingItem[] = r.items.map((it) => ({
    ...it, sku: map[normName(it.name)] ?? null,
  }));
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const p: NavistPending = {
    id, vendor: r.vendor || "(주)나비스트", date: r.date,
    items, total: r.total, at: new Date().toISOString(),
  };
  await savePending(p);
  return p;
}

const won = (n?: number) => (typeof n === "number" ? n.toLocaleString("ko-KR") : "");

/** 확인카드 텍스트 — 매핑 상태(재고반영 예정/미지정) 표시. */
export function buildNavistConfirmText(p: NavistPending): string {
  const lines = p.items.map((it, i) => {
    const tag = it.sku
      ? `→ 재고반영 [상품 ${it.sku.productNo}${it.sku.mall === "harriot" ? "/해리엇" : ""}]`
      : "→ ⚠️ SKU 미지정 (입고기록만)";
    const price = it.unitPrice ? ` @${won(it.unitPrice)}` : "";
    return `${i + 1}) ${it.name}: ${it.qty}개${price} ${tag}`;
  });
  const unmapped = p.items.filter((it) => !it.sku).length;
  const totalQty = p.items.reduce((a, it) => a + it.qty, 0);
  return [
    `📿 <b>나비스트 입고 확인</b>${p.date ? ` — ${p.date}` : ""}`,
    ...lines,
    `합계 ${totalQty}개${p.total ? ` · ${won(p.total)}원` : ""}`,
    "",
    unmapped
      ? `⚠️ 미지정 ${unmapped}건은 재고반영 없이 입고기록만. 매핑하려면 답장:\n<code>2=상품번호</code> (여러 개는 "1=195, 2=196")`
      : "모든 제품이 SKU에 연결됨 — 승인 시 재고 자동 반영.",
    "맞으면 [✅ 맞음], 틀리면 [❌ 취소] 후 다시 보내주세요.",
  ].join("\n");
}

/** "N=productNo" 매핑 파싱 → 항목별 지정. mall 기본 paulvice. */
export function parseMappingPairs(text: string): Array<{ index: number; productNo: number; mall?: "harriot" }> {
  const out: Array<{ index: number; productNo: number; mall?: "harriot" }> = [];
  const re = /(\d+)\s*=\s*(\d+)(\s*해리엇|\s*harriot)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ index: Number(m[1]), productNo: Number(m[2]), ...(m[3] ? { mall: "harriot" as const } : {}) });
  }
  return out;
}

/** 매핑 적용 — 제품명↔SKU 학습 + pending 갱신. 갱신된 pending 반환. */
export async function applyMapping(
  id: string,
  pairs: Array<{ index: number; productNo: number; mall?: "harriot" }>,
): Promise<{ pending: NavistPending | null; mapped: number; errors: string[] }> {
  const p = await loadNavistPending(id);
  if (!p) return { pending: null, mapped: 0, errors: ["만료/없는 입고건"] };
  const errors: string[] = [];
  let mapped = 0;
  for (const pr of pairs) {
    const it = p.items[pr.index - 1];
    if (!it) { errors.push(`${pr.index}번 항목 없음`); continue; }
    const ref: Cafe24Ref = { productNo: pr.productNo, mall: pr.mall || "paulvice" };
    it.sku = ref;
    await setSkuEntry(it.name, ref); // 다음 입고부터 자동
    mapped++;
  }
  if (mapped) await savePending(p);
  return { pending: p, mapped, errors };
}

/** 카페24 재고 반영 — 매핑된 항목만 +수량. 미매핑은 스킵. */
async function applyCafe24(items: NavistPendingItem[]): Promise<string> {
  const mapped = items.filter((it) => it.sku);
  if (!mapped.length) return "카페24 반영 없음(전부 미매핑)";
  try {
    const { getValidC24Token } = await import("@/lib/cafe24Auth");
    const applied: string[] = [];
    for (const it of mapped) {
      const { productNo, variantCode, mall } = it.sku as Cafe24Ref;
      const token = await getValidC24Token(mall || "paulvice");
      if (!token) { applied.push(`${it.name}: 토큰없음`); continue; }
      const mallId = (mall || "paulvice") === "harriot" ? process.env.HARRIOT_CAFE24_MALL_ID : process.env.CAFE24_MALL_ID;
      const base = `https://${mallId}.cafe24api.com/api/v2/admin`;
      const H = { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": "2026-03-01", "Content-Type": "application/json" };
      const vRes = await fetch(`${base}/products/${productNo}/variants`, { headers: H }).then((r) => r.json());
      const variants = (vRes.variants || []) as Array<{ variant_code: string; quantity: number }>;
      const v = variantCode ? variants.find((x) => x.variant_code === variantCode) : variants[0];
      if (!v) { applied.push(`${it.name}: variant없음`); continue; }
      const next = (v.quantity || 0) + it.qty;
      await fetch(`${base}/products/${productNo}/variants/${v.variant_code}/inventories`, {
        method: "PUT", headers: H, body: JSON.stringify({ request: { quantity: next } }),
      });
      applied.push(`${it.name} +${it.qty}→${next}`);
    }
    return applied.length ? `카페24: ${applied.join(", ")}` : "카페24 반영 없음";
  } catch (e) {
    return `카페24 반영 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`;
  }
}

/** 확인카드 [✅ 맞음] → 입고 원장 기록 + 카페24 재고반영(매핑분). */
export async function confirmNavistPending(id: string): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const p = await loadNavistPending(id);
  if (!p) return { ok: false, error: "만료/없는 입고건" };
  const cafe24 = await applyCafe24(p.items);
  await addReceipt({
    id: `nrcpt_${id}`, vendor: p.vendor, date: p.date, at: p.at,
    items: p.items.map(({ name, qty, unitPrice, amount }) => ({ name, qty, unitPrice, amount })),
    total: p.total, applied: cafe24,
  });
  await deletePending(id);
  const totalQty = p.items.reduce((a, it) => a + it.qty, 0);
  const unmapped = p.items.filter((it) => !it.sku).length;
  const summary = `입고 ${totalQty}개 장부기록${unmapped ? ` · 미매핑 ${unmapped}건 재고제외` : ""} · ${cafe24}`;
  return { ok: true, summary };
}

export async function rejectNavistPending(id: string): Promise<void> {
  await deletePending(id);
}
