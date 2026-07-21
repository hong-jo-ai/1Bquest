/**
 * 나비스트 주얼리 입고 자동처리 — 텔레그램 거래명세서 사진 → 판독 → '입고예정(PO)' 자동매칭 →
 * 확인카드(부분/완전입고 표시) → 승인 시 재고반영 + PO 처리 + 장부기록.
 *
 * 앵커 = 재고관리의 열린 나비스트 PO(status=ordered). 파쇼가 발주 매칭하듯, 명세서 제품을 PO에 매칭한다.
 *  - 완전입고(명세수량 ≥ 발주수량): PO status=received.
 *  - 부분입고(명세수량 < 발주수량): PO 발주수량을 잔여로 줄이고 ordered 유지 + 부분입고 메모.
 *  - 매칭 PO 없음: sku_map 폴백 또는 확인카드 "2=P00000BT" 수동지정. 없으면 입고기록만.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  getSkuMap, setSkuEntry, addReceipt, normName, type NavistReceiptItem,
} from "@/lib/navist/store";
import { listPurchaseOrders, updatePurchaseOrder, type PurchaseOrder } from "@/lib/purchaseOrders";
import { applyReceivedStock } from "@/lib/inventory/receiveStock";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

interface PoSnap { id: string; sku: string; productName: string; orderedQty: number }
export interface NavistPendingItem extends NavistReceiptItem {
  po?: PoSnap | null;   // 매칭된 입고예정 PO
  sku?: string | null;  // PO 없을 때 폴백 cafe24 product_code
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
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

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

/** 열린 나비스트 입고예정 PO(수동 등록분, status=ordered). */
async function openNavistPOs(): Promise<PurchaseOrder[]> {
  const all = await listPurchaseOrders().catch(() => [] as PurchaseOrder[]);
  return all.filter((p) => p.status === "ordered" && /나비스트|navist|nabist/i.test(p.supplier || ""));
}

const RECEIPT_TOOL = {
  name: "record_navist_receipt",
  description:
    "(주)나비스트(NABIST) 거래명세서 사진에서 제품별 입고 수량·단가를 추출하고, 각 제품을 " +
    "아래 '입고예정 목록'의 발주(poId)에 매칭합니다. 이름이 조금 달라도(예: '테니스팔찌' vs " +
    "'테니스 팔찌 - 실버') 같은 제품이면 매칭하세요. 숫자는 보이는 그대로, 추측 금지.",
  input_schema: {
    type: "object" as const,
    properties: {
      vendor: { type: "string", description: "공급처명. 보통 '(주)나비스트'." },
      date: { type: "string", description: "명세서 날짜(YYYY-MM-DD). 없으면 생략." },
      items: {
        type: "array",
        description: "제품별 입고 행. 명세서 순서대로.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "제품명 (예: 큐빅 싱글라인 테니스팔찌)" },
            qty: { type: "number", description: "입고 수량(정수)" },
            unitPrice: { type: "number", description: "단가(원). 없으면 생략." },
            amount: { type: "number", description: "합계 금액(원). 없으면 생략." },
            poId: { type: "string", description: "입고예정 목록에서 일치하는 발주 id. 없으면 생략." },
          },
          required: ["name", "qty"],
        },
      },
      total: { type: "number", description: "총 합계 금액(원). 없으면 생략." },
    },
    required: ["items"],
  },
};

interface ExtractedItem extends NavistReceiptItem { poId?: string }
export interface ExtractedNavist { vendor?: string; date?: string; total?: number; items: ExtractedItem[] }

/** 명세서 사진 판독 + 입고예정 PO 매칭(poId). */
export async function extractNavistReceipt(
  imageData: { data: string; mediaType: ImageMediaType },
): Promise<{ receipt: ExtractedNavist | null; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { receipt: null, error: "ANTHROPIC_API_KEY 미설정" };

  const pos = await openNavistPOs();
  const catalog = pos.length
    ? pos.map((p) => `- id=${p.id} | ${p.productName} | 발주 ${p.qty} | sku=${p.sku || "없음"}`).join("\n")
    : "(열린 입고예정 없음)";

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system:
      "너는 주얼리 공급처(나비스트) 거래명세서를 판독하고 입고예정 발주에 매칭하는 도우미다. " +
      "표의 제품명·단가·수량을 정확히 읽고 각 제품을 입고예정 목록의 poId에 연결해 record_navist_receipt를 정확히 한 번 호출한다. 숫자는 보이는 대로.",
    tools: [{ name: RECEIPT_TOOL.name, description: RECEIPT_TOOL.description, input_schema: RECEIPT_TOOL.input_schema as unknown as Anthropic.Tool["input_schema"] }],
    tool_choice: { type: "any" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.data } },
        { type: "text", text: `입고예정 목록(제품 매칭 후보):\n${catalog}\n\n위 (주)나비스트 거래명세서를 읽고, 각 제품을 목록에서 찾아 poId를 채워 record_navist_receipt를 호출하세요.` },
      ],
    }],
  });
  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!tu) return { receipt: null, error: "판독 실패(도구 미호출)" };
  const inp = tu.input as ExtractedNavist;
  if (!inp.items?.length) return { receipt: null, error: "제품 행을 읽지 못함" };
  return { receipt: inp };
}

/** pending 저장 — poId → PO 스냅샷 해석 + sku_map 폴백. */
export async function stageNavistPending(r: ExtractedNavist): Promise<NavistPending> {
  const [pos, skuMap] = await Promise.all([openNavistPOs(), getSkuMap()]);
  const byId = new Map(pos.map((p) => [p.id, p]));
  const items: NavistPendingItem[] = r.items.map((it) => {
    const po = it.poId ? byId.get(it.poId) : undefined;
    if (po) {
      return { name: it.name, qty: it.qty, unitPrice: it.unitPrice, amount: it.amount,
        po: { id: po.id, sku: po.sku, productName: po.productName, orderedQty: po.qty } };
    }
    return { name: it.name, qty: it.qty, unitPrice: it.unitPrice, amount: it.amount,
      sku: skuMap[normName(it.name)] ?? null };
  });
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const p: NavistPending = {
    id, vendor: r.vendor || "(주)나비스트", date: r.date,
    items, total: r.total, at: new Date().toISOString(),
  };
  await savePending(p);
  return p;
}

const won = (n?: number) => (typeof n === "number" ? n.toLocaleString("ko-KR") : "");

/** 확인카드 — PO 매칭·부분/완전입고 표시. */
export function buildNavistConfirmText(p: NavistPending): string {
  const lines = p.items.map((it, i) => {
    const price = it.unitPrice ? ` @${won(it.unitPrice)}` : "";
    let tag: string;
    if (it.po) {
      const rem = it.po.orderedQty - it.qty;
      tag = rem > 0
        ? `→ 📋 「${it.po.productName}」 부분입고 ${it.qty}/${it.po.orderedQty} (잔여 ${rem})`
        : `→ 📋 「${it.po.productName}」 완전입고`;
    } else if (it.sku) {
      tag = `→ 재고반영 [${it.sku}] (PO 없음)`;
    } else {
      tag = "→ ⚠️ 매칭 없음 (입고기록만)";
    }
    return `${i + 1}) ${it.name}: ${it.qty}개${price} ${tag}`;
  });
  const unresolved = p.items.filter((it) => !it.po && !it.sku).length;
  const totalQty = p.items.reduce((a, it) => a + it.qty, 0);
  return [
    `📿 <b>나비스트 입고 확인</b>${p.date ? ` — ${p.date}` : ""}`,
    ...lines,
    `합계 ${totalQty}개${p.total ? ` · ${won(p.total)}원` : ""}`,
    "",
    unresolved
      ? `⚠️ 미매칭 ${unresolved}건은 입고기록만. cafe24 상품코드로 지정하려면 답장:\n<code>2=P00000BT</code> (여러 개는 "1=P00000BT, 2=P00000BU")`
      : "승인 시 재고 자동 반영 + 입고예정 PO 처리(부분/완전).",
    "맞으면 [✅ 맞음], 틀리면 [❌ 취소] 후 다시 보내주세요.",
  ].join("\n");
}

/** "N=상품코드" 매핑 파싱 (cafe24 product_code는 영숫자). */
export function parseMappingPairs(text: string): Array<{ index: number; sku: string }> {
  const out: Array<{ index: number; sku: string }> = [];
  const re = /(\d+)\s*=\s*([A-Za-z0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ index: Number(m[1]), sku: m[2] });
  return out;
}

/** 매핑 적용 — 미매칭 항목에 cafe24 상품코드 지정 + sku_map 학습. */
export async function applyMapping(
  id: string,
  pairs: Array<{ index: number; sku: string }>,
): Promise<{ pending: NavistPending | null; mapped: number; errors: string[] }> {
  const p = await loadNavistPending(id);
  if (!p) return { pending: null, mapped: 0, errors: ["만료/없는 입고건"] };
  const errors: string[] = [];
  let mapped = 0;
  for (const pr of pairs) {
    const it = p.items[pr.index - 1];
    if (!it) { errors.push(`${pr.index}번 항목 없음`); continue; }
    it.sku = pr.sku;
    await setSkuEntry(it.name, pr.sku);
    mapped++;
  }
  if (mapped) await savePending(p);
  return { pending: p, mapped, errors };
}

/** 확인카드 [✅ 맞음] → 재고반영 + PO 처리(부분/완전) + 장부기록. */
export async function confirmNavistPending(id: string): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const p = await loadNavistPending(id);
  if (!p) return { ok: false, error: "만료/없는 입고건" };

  // PO notes append 위해 현재 PO 스냅샷
  const poList = await listPurchaseOrders().catch(() => [] as PurchaseOrder[]);
  const poById = new Map(poList.map((o) => [o.id, o]));
  const today = kstToday();
  const notes: string[] = [];

  for (const it of p.items) {
    const sku = it.po?.sku || it.sku;
    let stockNote = "";
    if (sku) {
      const res = await applyReceivedStock(sku, it.qty);
      stockNote = res.ok ? `재고+${it.qty}` : `재고반영실패(${res.error})`;
    } else {
      stockNote = "재고제외(미매칭)";
    }

    if (it.po) {
      const cur = poById.get(it.po.id);
      const orderedQty = cur?.qty ?? it.po.orderedQty;
      const rem = orderedQty - it.qty;
      if (rem > 0) {
        // 부분입고: 발주수량을 잔여로 줄이고 ordered 유지
        const prevNotes = cur?.notes ? String(cur.notes) : "";
        await updatePurchaseOrder(it.po.id, {
          qty: rem,
          notes: [prevNotes, `${today} 부분입고 ${it.qty} (잔여 ${rem})`].filter(Boolean).join(" / "),
        });
        notes.push(`${it.name}: 부분입고 ${it.qty}/${orderedQty}·잔여 ${rem}·${stockNote}`);
      } else {
        await updatePurchaseOrder(it.po.id, {
          status: "received", receivedDate: today, receivedQty: it.qty, stockApplied: sku ? true : false,
        });
        notes.push(`${it.name}: 완전입고 ${it.qty}·${stockNote}`);
      }
    } else {
      notes.push(`${it.name}: ${it.qty}·${stockNote}`);
    }
  }

  const summary = notes.join(" / ");
  await addReceipt({
    id: `nrcpt_${id}`, vendor: p.vendor, date: p.date, at: p.at,
    items: p.items.map(({ name, qty, unitPrice, amount }) => ({ name, qty, unitPrice, amount })),
    total: p.total, applied: summary,
  });
  await deletePending(id);
  return { ok: true, summary };
}

export async function rejectNavistPending(id: string): Promise<void> {
  await deletePending(id);
}
