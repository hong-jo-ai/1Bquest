/**
 * 네이버페이 카드내역 보강 — 우리카드+네이버페이 결제는 가맹점이 "네이버파이낸셜"로만 찍힘.
 * shong@harriotwatches.com 메일함(google_refresh_token)의 네이버페이 결제메일을 읽어
 * finance_card_usage의 네이버파이낸셜 행과 금액+시각으로 매칭 → 실제 가맹점·상품으로 보강.
 *
 * POST /api/finance/enrich-npay  (헤더 x-agent-token = PAULWISE_MCP_TOKEN, 또는 CRON_SECRET)
 *   → { ok, candidates, emails, enriched, skipped, preview }
 * 멱등: raw.npayEnriched = 결제번호 마킹된 행은 재처리 안 함.
 */
import { createClient } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";
import { parseNaverPayEmail, type ParsedNaverPayEmail } from "@/lib/finance/naverPayEmailParser";
import { categorizeMerchant } from "@/lib/finance/categorize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

function getDb() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

function b64urlDecode(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

// Gmail payload에서 본문(plain 우선, 없으면 html) 추출
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) return b64urlDecode(payload.body.data);
  const parts: GmailPart[] = payload.parts || [];
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain?.body?.data) return b64urlDecode(plain.body.data);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (html?.body?.data) return b64urlDecode(html.body.data);
  for (const p of parts) { const t = extractBody(p); if (t) return t; }
  return "";
}

async function gmail<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return r.json() as Promise<T>;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  const cron = req.headers.get("x-cron-secret");
  const ok = (process.env.PAULWISE_MCP_TOKEN && token === process.env.PAULWISE_MCP_TOKEN) ||
    (process.env.CRON_SECRET && cron === process.env.CRON_SECRET);
  if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = getDb();
  if (!db) return Response.json({ error: "Supabase 미설정" }, { status: 500 });

  // 디버그: ?debug=1 → 토큰이 읽는 Gmail 계정·쿼리 적중수만 반환 (메일 내용 노출 안 함)
  if (req.nextUrl.searchParams.get("debug") === "1") {
    const at = await getGoogleAccessTokenFromStore();
    if (!at) return Response.json({ debug: true, error: "토큰 없음" });
    const prof = await gmail<{ emailAddress?: string; messagesTotal?: number }>(at, "/profile").catch((e) => ({ err: String(e) }));
    const q1 = await gmail<{ resultSizeEstimate?: number }>(at, `/messages?q=${encodeURIComponent("subject:네이버페이 newer_than:7d")}&maxResults=5`).catch((e) => ({ err: String(e) }));
    const q2 = await gmail<{ resultSizeEstimate?: number }>(at, `/messages?q=${encodeURIComponent("from:naverpayadmin_noreply@navercorp.com newer_than:7d")}&maxResults=5`).catch((e) => ({ err: String(e) }));
    return Response.json({ debug: true, account: prof, subjectNaverPay: q1, fromNaverPay: q2 });
  }

  // 1) 미보강 네이버페이/네이버파이낸셜 카드행 (최근 90일)
  //    우리카드 SMS 가맹점 표기가 "네이버페이" 또는 "네이버파이낸셜" 둘 다 나옴 → 둘 다 후보.
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: rows } = await db
    .from("finance_card_usage")
    .select("id, use_date, amount, merchant, raw")
    .or("merchant.ilike.%네이버파이낸셜%,merchant.ilike.%네이버페이%")
    .gte("use_date", since)
    .order("use_date", { ascending: false })
    .limit(300);
  const pending = (rows ?? []).filter((r) => !(r.raw as Record<string, unknown> | null)?.npayEnriched);
  if (!pending.length) return Response.json({ ok: true, candidates: 0, emails: 0, enriched: 0, skipped: 0 });

  // 2) 메일함에서 네이버페이 결제메일 수집 (대상행 기간 + 여유 1일)
  const accessToken = await getGoogleAccessTokenFromStore();
  if (!accessToken) return Response.json({ error: "Gmail 토큰 없음(shong@ 재연결 필요)" }, { status: 502 });
  const oldest = Math.min(...pending.map((r) => new Date(r.use_date).getTime()));
  const days = Math.min(95, Math.ceil((Date.now() - oldest) / 86400000) + 2);
  // ⚠️ 따옴표 한글구문+괄호+OR 복합 쿼리는 raw Gmail API에서 0건 반환(2026-06-18 확인) →
  //    확정 발신자 기반 단순 쿼리로 견고화. 메일 종류(결제/자동결제/구매확정 등)는 파서·매칭이 걸러냄.
  const q = `from:naverpayadmin_noreply@navercorp.com newer_than:${days}d`;
  const list = await gmail<{ messages?: { id: string }[] }>(accessToken, `/messages?q=${encodeURIComponent(q)}&maxResults=200`);
  const emails: ParsedNaverPayEmail[] = [];
  for (const m of list.messages ?? []) {
    try {
      const full = await gmail<{ payload?: GmailPart }>(accessToken, `/messages/${m.id}?format=full`);
      const parsed = parseNaverPayEmail(extractBody(full.payload));
      if (parsed && parsed.merchant && (parsed.cardAmount || parsed.totalAmount)) emails.push(parsed);
    } catch { /* skip one */ }
  }

  // 3) 카드행 ↔ 메일 매칭 (금액 일치 + 결제일시 ±30분)
  let enriched = 0;
  const preview: Array<{ from: string; to: string; amount: number; category: string }> = [];
  const used = new Set<string>();
  for (const row of pending) {
    const rowAmt = Number(row.amount) || 0;
    const rowTime = new Date(row.use_date).getTime();
    let best: ParsedNaverPayEmail | null = null;
    let bestDiff = Infinity;
    for (const e of emails) {
      if (e.payNo && used.has(e.payNo)) continue;
      const amtOk = rowAmt === e.cardAmount || rowAmt === e.totalAmount;
      if (!amtOk || !e.paidAt) continue;
      const diff = Math.abs(e.paidAt.getTime() - rowTime);
      if (diff <= 30 * 60000 && diff < bestDiff) { best = e; bestDiff = diff; }
    }
    if (!best) continue;
    if (best.payNo) used.add(best.payNo);
    const newMerchant = `${best.merchant} (네이버페이)`;
    const category = categorizeMerchant(best.merchant);
    const { error } = await db
      .from("finance_card_usage")
      .update({
        merchant: newMerchant,
        category,
        category_source: "email",
        raw: { ...(row.raw as Record<string, unknown>), npayEnriched: best.payNo || true, npayMerchant: best.merchant, npayMethod: best.method },
      })
      .eq("id", row.id);
    if (!error) { enriched++; preview.push({ from: row.merchant, to: newMerchant, amount: rowAmt, category }); }
  }

  return Response.json({
    ok: true,
    candidates: pending.length,
    emails: emails.length,
    enriched,
    skipped: pending.length - enriched,
    preview,
  });
}
