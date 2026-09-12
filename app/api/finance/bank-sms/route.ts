/**
 * 우리은행 입출금 알림 SMS 적재 — iMac 에이전트(wooriBankSms.js)가 chat.db에서 읽어 POST.
 *
 * 왜: 통장(finance_bank_tx)은 엑셀 업로드 전용이라 사장님이 안 올리면 공백이 났다(2026-08-18 이후 0건).
 *     알림 문자는 계속 오니 그걸로 자동 적재해 엑셀 업로드를 없앤다(2026-09-12).
 *
 * 헤더: x-agent-token: <PAULWISE_MCP_TOKEN>. Body: { messages: [{ text, id, receivedAtMs? }] }
 *
 * 이중 계상 방지(핵심):
 *  - 우리 체크카드 결제는 카드 승인 문자(finance_card_usage/card_woori_sms)로 이미 잡힌다 →
 *    같은 금액 ±10분 카드행이 있으면 통장행은 '카드결제'(손익 집계에서 제외되는 카테고리).
 *  - 현대카드는 **체크카드**라 통장 출금 1건 = 결제 1건인데 가맹점이 문자에 없다 →
 *    통장행은 '카드결제'로 두고, 카드 사용내역(card_hyundai_sms)에 "가맹점 미상"으로 1건 넣은 뒤
 *    텔레그램으로 "뭐였어요?"를 물어 답장으로 채운다(PG 결제와 같은 흐름).
 *  - 그 외 출금은 통장 규칙 분류. 개인계좌(849) 에서 규칙에 안 걸리면 '개인'.
 *
 * 부수 효과: 계좌별 최신 잔액을 kv `bank_balance:<계좌>` 에 남긴다("통장 잔고" 질문용).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { parseWooriBankSms, type ParsedWooriBankSms } from "@/lib/finance/wooriBankSmsParser";
import { categorizeTx } from "@/lib/finance/categorize";
import { enqueueCardClassify } from "@/lib/finance/cardClassify";
import { HYUNDAI_STUB_MERCHANT } from "@/lib/finance/hyundaiCardSmsParser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SmsIn { text: string; id: string; receivedAtMs?: number }

function getDb(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

function fmtKst(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}

/** 같은 금액의 우리카드 승인(±10분)이 카드 사용내역에 있는가 — 있으면 통장행은 그 결제의 그림자다. */
async function hasWooriCardTwin(db: SupabaseClient, p: ParsedWooriBankSms): Promise<boolean> {
  const lo = new Date(p.txDate.getTime() - 10 * 60_000).toISOString();
  const hi = new Date(p.txDate.getTime() + 10 * 60_000).toISOString();
  const col = p.kind === "출금취소" ? "cancel_amount" : "amount";
  const { data } = await db
    .from("finance_card_usage")
    .select("id")
    .eq("source", "card_woori_sms")
    .eq(col, p.amount)
    .gte("use_date", lo)
    .lte("use_date", hi)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * 같은 금액의 **실제** 현대카드 승인행(가맹점 있는 것, ±10분)이 이미 있는가.
 * 승인 문자 알림을 켠 뒤(2026-09-12)엔 결제 1건에 승인 문자 + 통장 출금 문자가 둘 다 오므로,
 * 승인행이 먼저 들어와 있으면 "가맹점 미상" 행을 또 만들면 안 된다. (반대 순서는 card-sms 라우트가 병합)
 */
async function hasHyundaiApprovalTwin(db: SupabaseClient, p: ParsedWooriBankSms): Promise<boolean> {
  const lo = new Date(p.txDate.getTime() - 10 * 60_000).toISOString();
  const hi = new Date(p.txDate.getTime() + 10 * 60_000).toISOString();
  const col = p.kind === "출금취소" ? "cancel_amount" : "amount";
  const { data } = await db
    .from("finance_card_usage")
    .select("id")
    .eq("source", "card_hyundai_sms")
    .eq(col, p.amount)
    .gte("use_date", lo)
    .lte("use_date", hi)
    .not("merchant", "like", `${HYUNDAI_STUB_MERCHANT}%`)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  if (!db) return Response.json({ error: "Supabase 미설정" }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { messages?: SmsIn[]; ask?: boolean };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  // 되채우기(--no-ask)에선 묻지 않는다 — 한 달치 현대카드 결제를 한꺼번에 물으면 답할 수 없다.
  const askHyundai = body.ask !== false;
  if (!messages.length) return Response.json({ ok: true, received: 0, parsed: 0, inserted: 0 });

  const { data: biz } = await db.from("finance_businesses").select("id").eq("is_default", true).maybeSingle();
  const businessId = biz?.id ?? null;
  if (!businessId) return Response.json({ error: "기본 사업자가 없습니다" }, { status: 500 });

  const bankRecords: Array<Record<string, unknown>> = [];
  const hyundaiCardRecords: Array<Record<string, unknown>> = [];
  const preview: Array<Record<string, unknown>> = [];
  const latestBalance = new Map<string, { balance: number; at: Date; counterparty: string }>();
  let nonBank = 0;

  for (const m of messages) {
    if (!m?.text || !m?.id) continue;
    const p = parseWooriBankSms(m.text, m.receivedAtMs);
    if (!p) { nonBank++; continue; }

    const isOut = p.kind === "출금" || p.kind === "입금취소";
    const withdrawal = isOut ? p.amount : 0;
    const deposit = isOut ? 0 : p.amount;
    const isHyundai = /현대카드/.test(p.counterparty);

    let category: string;
    let categorySource: string;
    let description: string;
    if (isHyundai && p.kind !== "입금") {
      // 현대 체크카드 결제(또는 그 취소) — 카드 사용내역 쪽에서 비용으로 잡고 통장행은 제외.
      category = "카드결제"; categorySource = "rule-dup"; description = "체크현대";
      if (!(await hasHyundaiApprovalTwin(db, p))) hyundaiCardRecords.push({
        business_id: businessId,
        source: "card_hyundai_sms",
        card_company: "현대",
        card_number: "",
        approval_no: `sms-${m.id}`,
        use_date: p.txDate.toISOString(),
        cancel_date: p.kind === "출금취소" ? p.txDate.toISOString() : null,
        merchant: HYUNDAI_STUB_MERCHANT,
        amount: p.kind === "출금취소" ? 0 : p.amount,
        cancel_amount: p.kind === "출금취소" ? p.amount : 0,
        supply_amount: null, tax_amount: null,
        installment: "체크",
        category: "기타",
        category_source: "rule",
        raw: { fromBankSms: true, ns: m.id, sms: m.text },
      });
    } else if (p.kind !== "입금" && (await hasWooriCardTwin(db, p))) {
      category = "카드결제"; categorySource = "rule-dup"; description = "체크우리";
    } else {
      // 출금취소는 "돈이 돌아온 것"이라 입금으로 적되, 카테고리는 원래 지출 성격을 따른다.
      const c = categorizeTx({
        description: "", counterparty: p.counterparty, memo: "",
        withdrawal: p.kind === "출금취소" ? p.amount : withdrawal,
        deposit: p.kind === "출금취소" ? 0 : deposit,
      });
      category = c.category; categorySource = c.source;
      if (p.isPersonalAccount && isOut && category === "기타") category = "개인";
      description = p.kind === "출금" ? "SMS출금" : p.kind === "입금" ? "SMS입금" : p.kind;
    }

    bankRecords.push({
      business_id: businessId,
      bank: p.bank,
      account_number: p.accountNumber,
      tx_date: p.txDate.toISOString(),
      description,
      counterparty: p.counterparty,
      memo: "",
      withdrawal,
      deposit,
      balance: p.balance,
      branch: "SMS",
      category,
      category_source: categorySource,
      raw: { fromSms: true, ns: m.id, kind: p.kind, accountTail: p.accountTail, sms: m.text },
    });
    preview.push({ at: fmtKst(p.txDate), acct: p.accountTail, kind: p.kind, amount: p.amount, counterparty: p.counterparty, category });

    if (p.balance != null) {
      const cur = latestBalance.get(p.accountNumber);
      if (!cur || p.txDate > cur.at) latestBalance.set(p.accountNumber, { balance: p.balance, at: p.txDate, counterparty: p.counterparty });
    }
  }

  if (!bankRecords.length) return Response.json({ ok: true, received: messages.length, parsed: 0, inserted: 0, nonBank });

  // 엑셀 업로드분과 같은 unique(사업자·시각·출금·입금·잔액) → 겹치는 구간을 다시 보내도 중복이 안 쌓인다.
  const { data, error } = await db
    .from("finance_bank_tx")
    .upsert(bankRecords, { onConflict: "business_id,tx_date,withdrawal,deposit,balance", ignoreDuplicates: true })
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 현대 체크카드 결제 → 카드 사용내역 1건 + 텔레그램 문의(신규 적재분만).
  let asked = 0;
  if (hyundaiCardRecords.length) {
    const { data: cardRows, error: cardErr } = await db
      .from("finance_card_usage")
      .upsert(hyundaiCardRecords, { onConflict: "business_id,source,approval_no,use_date", ignoreDuplicates: true })
      .select("id, merchant, amount, use_date");
    if (cardErr) return Response.json({ error: `카드행 적재 실패: ${cardErr.message}` }, { status: 500 });
    const chatId = process.env.TELEGRAM_CHAT_ID;
    for (const row of (cardRows ?? []) as Array<{ id: string; merchant: string; amount: number; use_date: string }>) {
      if (!askHyundai || !chatId || Number(row.amount) <= 0) continue;
      await enqueueCardClassify(row, chatId);
      await sendTelegram(chatId, `🟡 현대카드 결제 ${Number(row.amount).toLocaleString()}원 (${fmtKst(new Date(row.use_date))}) — 어디서 쓰신 건가요?\n답장으로 알려주세요. 예) "이마트"  또는  "이마트 / 개인"`);
      asked++;
    }
  }

  // 계좌별 최신 잔액 스냅샷(같은 계좌의 더 최신 기록이 있으면 덮지 않는다).
  for (const [acct, v] of latestBalance) {
    const key = `bank_balance:${acct}`;
    const { data: cur } = await db.from("kv_store").select("data").eq("key", key).maybeSingle();
    const curAt = (cur?.data as { at?: string } | null)?.at;
    if (curAt && new Date(curAt) >= v.at) continue;
    await db.from("kv_store").upsert(
      { key, data: { balance: v.balance, at: v.at.toISOString(), counterparty: v.counterparty, source: "woori_sms" }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  }

  return Response.json({
    ok: true,
    received: messages.length,
    parsed: bankRecords.length,
    inserted: data?.length ?? 0,
    skipped: bankRecords.length - (data?.length ?? 0),
    hyundaiCards: hyundaiCardRecords.length,
    asked,
    nonBank,
    preview: preview.slice(0, 20),
  });
}
