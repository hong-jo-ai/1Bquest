/**
 * 우리카드 승인/취소 SMS 적재 — iMac 에이전트(wooriCardSms.js)가 chat.db에서 읽어 POST.
 * 카드 알림 SMS 원문을 받아 서버에서 파싱·분류·upsert(엑셀 업로드 대체).
 * 헤더: x-agent-token: <PAULWISE_MCP_TOKEN>. Body: { messages: [{ text, id, receivedAtMs? }] }
 *   id = chat.db 메시지 고유값(Apple epoch ns 문자열) → 승인번호 대용(중복방지).
 */
import { createClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { parseWooriCardSms } from "@/lib/finance/wooriCardSmsParser";
import { parseHyundaiCardSms, HYUNDAI_STUB_MERCHANT, type ParsedCardSms } from "@/lib/finance/hyundaiCardSmsParser";
import { getUsdToKrw } from "@/lib/finance/forex";
import { categorizeMerchant } from "@/lib/finance/categorize";
import { isPgMerchant, enqueueCardClassify } from "@/lib/finance/cardClassify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 텔레그램 메시지 전송 (PG 결제 즉시 문의용)
async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

function fmtKst(iso: string): string {
  const d = new Date(iso);
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}

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

  const usdRate = await getUsdToKrw();
  const records: Array<Record<string, unknown>> = [];
  const preview: Array<Record<string, unknown>> = [];
  let nonCard = 0;
  let merged = 0; // 현대카드 "가맹점 미상" 행을 실제 승인으로 채운 건수
  for (const m of messages) {
    if (!m?.text || !m?.id) continue;
    // 우리카드 형식이 아니면 현대카드 형식으로 시도(2026-09-12 — 현대카드 승인 문자를 켜면 여기로 들어온다).
    const p: ParsedCardSms | null = parseWooriCardSms(m.text, m.receivedAtMs, usdRate) ?? parseHyundaiCardSms(m.text, m.receivedAtMs);
    if (!p || (p.amount <= 0 && !p.isCanceled)) { nonCard++; continue; }
    const category = categorizeMerchant(p.merchant);
    // 해외승인: 가맹점명에 외화 표기 덧붙임(원화는 환율 추정치임을 명확히). 분류는 원래 가맹점명 기준.
    const fx = p.isForeign && p.foreignAmount > 0 ? ` (${p.foreignCurrency} ${p.foreignAmount})` : "";
    const installment = [p.cardKind, p.installment, p.isForeign ? "해외(추정환산)" : ""].filter(Boolean).join("/");
    // 현대카드: 통장 출금 문자(bank-sms)가 먼저 와서 "가맹점 미상" 행을 만들어 뒀으면 새 행 대신 그 행을 채운다.
    // (현대카드는 체크카드라 결제 1건에 승인 문자 + 통장 출금 문자가 둘 다 온다 — 2026-09-12)
    if (p.cardCompany === "현대") {
      const lo = new Date(p.useDate.getTime() - 10 * 60_000).toISOString();
      const hi = new Date(p.useDate.getTime() + 10 * 60_000).toISOString();
      const { data: stub } = await db
        .from("finance_card_usage")
        .select("id, raw")
        .eq("source", "card_hyundai_sms")
        .like("merchant", `${HYUNDAI_STUB_MERCHANT}%`)
        .eq(p.isCanceled ? "cancel_amount" : "amount", p.amount)
        .gte("use_date", lo)
        .lte("use_date", hi)
        .limit(1);
      const s = stub?.[0] as { id: string; raw: Record<string, unknown> | null } | undefined;
      if (s) {
        await db.from("finance_card_usage").update({
          merchant: p.merchant + fx,
          card_number: p.cardNumber,
          installment,
          category,
          category_source: "rule",
          raw: { ...(s.raw ?? {}), approvalSms: { ...p, useDate: p.useDate.toISOString() } },
        }).eq("id", s.id);
        await db.from("kv_store").delete().eq("key", `card_classify:${s.id}`); // "어디서 쓰셨나요?" 문의는 더 이상 필요 없다
        merged++;
        preview.push({ merchant: p.merchant, amount: p.amount, category, cancel: p.isCanceled, merged: true });
        continue;
      }
    }
    records.push({
      business_id: businessId,
      source: p.cardCompany === "현대" ? "card_hyundai_sms" : "card_woori_sms",
      card_company: p.cardCompany,
      card_number: p.cardNumber,
      approval_no: `sms-${m.id}`,
      use_date: p.useDate.toISOString(),
      cancel_date: p.isCanceled ? p.useDate.toISOString() : null,
      merchant: p.merchant + fx,
      amount: p.isCanceled ? 0 : p.amount,
      cancel_amount: p.isCanceled ? p.amount : 0,
      supply_amount: null,
      tax_amount: null,
      installment,
      category,
      category_source: "rule",
      raw: { ...p, useDate: p.useDate.toISOString() },
    });
    preview.push({ merchant: p.merchant, amount: p.amount, category, cancel: p.isCanceled });
  }

  if (!records.length) {
    return Response.json({ ok: true, received: messages.length, parsed: 0, inserted: 0, merged, nonCard, preview });
  }

  const { data, error } = await db
    .from("finance_card_usage")
    .upsert(records, { onConflict: "business_id,source,approval_no,use_date", ignoreDuplicates: true })
    .select("id, merchant, amount, use_date");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // PG 경유(실제 가맹점 가려짐) 신규 결제 → 즉시 텔레그램으로 "이거 뭐였어?" 문의 (실시간 분류)
  const chatId = process.env.TELEGRAM_CHAT_ID;
  let asked = 0;
  for (const row of (data ?? []) as Array<{ id: string; merchant: string; amount: number; use_date: string }>) {
    if (Number(row.amount) <= 0 || !isPgMerchant(row.merchant)) continue;
    if (chatId) {
      await enqueueCardClassify(row, chatId);
      await sendTelegram(chatId, `🟡 이 카드결제는 무엇이었나요? (PG라 가맹점이 가려져요)\n\n${row.merchant} · ₩${Number(row.amount).toLocaleString()} · ${fmtKst(row.use_date)}\n\n답장으로 알려주세요. 예) "뱀부랩 필라멘트"  또는  "뱀부랩 필라멘트 / 부자재"`);
      asked++;
    }
  }

  return Response.json({
    asked,
    merged,
    ok: true,
    received: messages.length,
    parsed: records.length,
    inserted: data?.length ?? 0,
    skipped: records.length - (data?.length ?? 0),
    nonCard,
    preview,
  });
}
