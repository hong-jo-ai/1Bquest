/**
 * 우리카드 승인/취소 SMS 적재 — iMac 에이전트(wooriCardSms.js)가 chat.db에서 읽어 POST.
 * 카드 알림 SMS 원문을 받아 서버에서 파싱·분류·upsert(엑셀 업로드 대체).
 * 헤더: x-agent-token: <PAULWISE_MCP_TOKEN>. Body: { messages: [{ text, id, receivedAtMs? }] }
 *   id = chat.db 메시지 고유값(Apple epoch ns 문자열) → 승인번호 대용(중복방지).
 */
import { createClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { parseWooriCardSms } from "@/lib/finance/wooriCardSmsParser";
import { categorizeMerchant } from "@/lib/finance/categorize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

interface SmsIn {
  text: string;
  id: string; // chat.db 메시지 고유값
  receivedAtMs?: number; // 수신 unix ms (연도 보정용)
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  if (!db) return Response.json({ error: "Supabase 미설정" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { messages?: SmsIn[] };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return Response.json({ ok: true, received: 0, parsed: 0, inserted: 0 });

  const { data: biz } = await db
    .from("finance_businesses")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();
  const businessId = biz?.id ?? null;
  if (!businessId) return Response.json({ error: "기본 사업자가 없습니다" }, { status: 500 });

  const records: Array<Record<string, unknown>> = [];
  const preview: Array<Record<string, unknown>> = [];
  let nonCard = 0;
  for (const m of messages) {
    if (!m?.text || !m?.id) continue;
    const p = parseWooriCardSms(m.text, m.receivedAtMs);
    if (!p || (p.amount <= 0 && !p.isCanceled)) { nonCard++; continue; }
    const category = categorizeMerchant(p.merchant);
    records.push({
      business_id: businessId,
      source: "card_woori_sms",
      card_company: p.cardCompany,
      card_number: p.cardNumber,
      approval_no: `sms-${m.id}`,
      use_date: p.useDate.toISOString(),
      cancel_date: p.isCanceled ? p.useDate.toISOString() : null,
      merchant: p.merchant,
      amount: p.isCanceled ? 0 : p.amount,
      cancel_amount: p.isCanceled ? p.amount : 0,
      supply_amount: null,
      tax_amount: null,
      installment: [p.cardKind, p.installment].filter(Boolean).join("/"),
      category,
      category_source: "rule",
      raw: { ...p, useDate: p.useDate.toISOString() },
    });
    preview.push({ merchant: p.merchant, amount: p.amount, category, cancel: p.isCanceled });
  }

  if (!records.length) {
    return Response.json({ ok: true, received: messages.length, parsed: 0, inserted: 0, nonCard });
  }

  const { data, error } = await db
    .from("finance_card_usage")
    .upsert(records, { onConflict: "business_id,source,approval_no,use_date", ignoreDuplicates: true })
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    received: messages.length,
    parsed: records.length,
    inserted: data?.length ?? 0,
    skipped: records.length - (data?.length ?? 0),
    nonCard,
    preview,
  });
}
