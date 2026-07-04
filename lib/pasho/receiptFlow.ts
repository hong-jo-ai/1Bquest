/**
 * 파쇼 입고 자동처리 — 텔레그램 사진("입고") → 비전 판독 → 확인카드 → 기록 → 카페24 반영.
 *  1) extractReceiptFromImage: 입고증 사진에서 발주·색상별 수량 추출 (열린 발주 목록을 컨텍스트로 매칭)
 *  2) 확인카드로 미리보기(잔량 계산) → 콜백 [✅ 맞음]에서 confirmPendingReceipt
 *  3) 기록 + (라인에 cafe24 매핑 있을 때) 재고 반영
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  getOrdersWithBalance, getOrderWithBalance, addReceipt,
  type OrderWithBalance, type ReceiptItem,
} from "@/lib/pasho/store";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface PendingReceipt {
  id: string; orderNo: string; model: string;
  items: ReceiptItem[]; note?: string; at: string;
}

function kv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
async function pendKey(id: string) { return `pasho:pending:${id}`; }
async function savePending(p: PendingReceipt): Promise<void> {
  const sb = kv(); if (!sb) return;
  await sb.from("kv_store").upsert(
    { key: await pendKey(p.id), data: p, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
async function loadPending(id: string): Promise<PendingReceipt | null> {
  const sb = kv(); if (!sb) return null;
  const { data } = await sb.from("kv_store").select("data").eq("key", await pendKey(id)).maybeSingle();
  return (data?.data as PendingReceipt) ?? null;
}
async function deletePending(id: string): Promise<void> {
  const sb = kv(); if (!sb) return;
  await sb.from("kv_store").delete().eq("key", await pendKey(id));
}

const RECEIPT_TOOL = {
  name: "record_pasho_receipt",
  description:
    "파쇼(협력사)가 준 입고증/수령확인서 사진에서 어떤 발주의 어떤 색상(옵션)이 몇 개 입고됐는지 추출합니다. " +
    "아래 '진행 중 발주 목록'에서 가장 잘 맞는 발주번호(orderNo)와 색상 라인을 골라 매칭하세요. " +
    "폼의 색상/옵션 명칭이 목록과 다르면 목록의 라인 명칭으로 정규화하고, 애매하면 폼 원문을 그대로 씁니다.",
  input_schema: {
    type: "object" as const,
    properties: {
      orderNo: { type: "string", description: "발주번호(P26-001 등). 목록에서 모델명으로 매칭." },
      items: {
        type: "array",
        description: "색상별 입고 수량. 폼에 적힌 대로.",
        items: {
          type: "object",
          properties: {
            variant: { type: "string", description: "색상/옵션명 (목록 라인명에 맞춤)" },
            qty: { type: "number", description: "입고 수량(정수)" },
          },
          required: ["variant", "qty"],
        },
      },
      note: { type: "string", description: "폼의 특이사항(부분입고·잔여 예정 등). 없으면 생략." },
      confidence: { type: "string", enum: ["high", "low"], description: "판독 확신도" },
    },
    required: ["orderNo", "items"],
  },
};

export interface ExtractedReceipt {
  orderNo: string; items: ReceiptItem[]; note?: string; confidence?: string;
}

/** 입고증 사진 판독 → 발주·색상별 수량 */
export async function extractReceiptFromImage(
  imageData: { data: string; mediaType: ImageMediaType },
): Promise<{ receipt: ExtractedReceipt | null; error?: string; order?: OrderWithBalance }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { receipt: null, error: "ANTHROPIC_API_KEY 미설정" };

  const orders = await getOrdersWithBalance();
  const open = orders.filter((o) => o.type !== "개발" || o.remainingQty > 0);
  const catalog = open.map((o) => {
    const lines = o.lines.map((l) => `${l.variant}(잔량 ${l.remaining})`).join(", ");
    return `- ${o.no} ${o.model}: ${lines}`;
  }).join("\n");

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system:
      "너는 시계 제조 협력사(파쇼) 입고증을 판독하는 도우미다. 사진 속 표/수기 숫자를 정확히 읽어 " +
      "발주번호와 색상별 입고수량을 record_pasho_receipt 도구로 정확히 한 번 호출한다. 숫자를 추측하지 말고 보이는 대로 읽어라.",
    tools: [{ name: RECEIPT_TOOL.name, description: RECEIPT_TOOL.description, input_schema: RECEIPT_TOOL.input_schema as unknown as Anthropic.Tool["input_schema"] }],
    tool_choice: { type: "any" },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.data } },
        { type: "text", text: `진행 중 발주 목록:\n${catalog}\n\n위 입고증 사진을 읽고 record_pasho_receipt를 호출하세요.` },
      ],
    }],
  });
  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!tu) return { receipt: null, error: "판독 실패(도구 미호출)" };
  const inp = tu.input as ExtractedReceipt;
  const order = orders.find((o) => o.no === inp.orderNo);
  return { receipt: inp, order };
}

/** 확인카드용 미리보기 텍스트 (잔량 계산) */
export function buildConfirmText(order: OrderWithBalance, items: ReceiptItem[], note?: string): string {
  const lines = items.map((it) => {
    const line = order.lines.find((l) => l.variant === it.variant);
    const already = line?.received ?? 0;
    const ordered = line?.qty ?? 0;
    const after = already + it.qty;
    const rem = Math.max(0, ordered - after);
    return `· ${it.variant}: 입고 ${it.qty}` + (line ? ` → 누적 ${after}/${ordered} · 잔량 ${rem}` : " (신규 옵션?)");
  });
  const totalIn = items.reduce((a, it) => a + it.qty, 0);
  return [
    `📦 <b>입고 확인</b> — ${order.no} ${order.model}`,
    ...lines,
    `합계 입고 ${totalIn}`,
    note ? `메모: ${note}` : null,
    "",
    "맞으면 [✅ 맞음], 틀리면 [❌ 취소] 후 다시 보내주세요.",
  ].filter(Boolean).join("\n");
}

/** pending 저장 + id 반환 */
export async function stagePendingReceipt(r: ExtractedReceipt, model: string): Promise<PendingReceipt> {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const p: PendingReceipt = { id, orderNo: r.orderNo, model, items: r.items, note: r.note, at: new Date().toISOString() };
  await savePending(p);
  return p;
}

/** 카페24 재고 반영 — 라인에 cafe24 매핑이 있을 때만. 없으면 스킵(신규 미런칭 모델). */
async function applyCafe24(orderNo: string, items: ReceiptItem[]): Promise<string> {
  const order = await getOrderWithBalance(orderNo);
  if (!order) return "발주 없음";
  const mapped = order.lines.filter((l) => l.cafe24);
  if (mapped.length === 0) return "카페24 미연동(모델 매핑 없음)";
  try {
    const { getValidC24Token } = await import("@/lib/cafe24Auth");
    const applied: string[] = [];
    for (const it of items) {
      const line = order.lines.find((l) => l.variant === it.variant);
      if (!line?.cafe24) continue;
      const { productNo, variantCode, mall } = line.cafe24;
      const token = await getValidC24Token(mall || "paulvice");
      if (!token) { applied.push(`${it.variant}: 토큰없음`); continue; }
      const mallId = (mall || "paulvice") === "harriot" ? process.env.HARRIOT_CAFE24_MALL_ID : process.env.CAFE24_MALL_ID;
      const base = `https://${mallId}.cafe24api.com/api/v2/admin`;
      const H = { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": "2026-03-01", "Content-Type": "application/json" };
      // variant 재고 조회 → +qty
      const vRes = await fetch(`${base}/products/${productNo}/variants`, { headers: H }).then((r) => r.json());
      const variants = (vRes.variants || []) as Array<{ variant_code: string; quantity: number }>;
      const v = variantCode ? variants.find((x) => x.variant_code === variantCode) : variants[0];
      if (!v) { applied.push(`${it.variant}: variant없음`); continue; }
      const next = (v.quantity || 0) + it.qty;
      await fetch(`${base}/products/${productNo}/variants/${v.variant_code}/inventories`, {
        method: "PUT", headers: H, body: JSON.stringify({ request: { quantity: next } }),
      });
      applied.push(`${it.variant} +${it.qty}→${next}`);
    }
    return applied.length ? `카페24: ${applied.join(", ")}` : "카페24 반영 없음";
  } catch (e) {
    return `카페24 반영 실패: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`;
  }
}

/** 확인카드 [✅ 맞음] → 기록 + 카페24 반영 */
export async function confirmPendingReceipt(id: string): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const p = await loadPending(id);
  if (!p) return { ok: false, error: "만료/없는 입고건" };
  await addReceipt({ orderNo: p.orderNo, at: p.at, items: p.items, note: p.note, id: `rcpt_${id}` });
  const cafe24 = await applyCafe24(p.orderNo, p.items);
  await deletePending(id);
  const order = await getOrderWithBalance(p.orderNo);
  const totalIn = p.items.reduce((a, it) => a + it.qty, 0);
  const rem = order?.remainingQty ?? 0;
  const summary = `입고 ${totalIn} 기록 · 잔량 ${rem}${rem > 0 ? "" : " (완료)"} · ${cafe24}`;
  return { ok: true, summary };
}

export async function rejectPendingReceipt(id: string): Promise<void> {
  await deletePending(id);
}
