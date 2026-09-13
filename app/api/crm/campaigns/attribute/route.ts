/**
 * 캠페인 구매 귀속 — 발송 이후 들어온 카페24 주문을 캠페인 대상과 대조해 purchased 로 채운다.
 *
 * 귀속 우선순위 (정확도 순)
 *   ① 쿠폰코드 — 주문에 캠페인 전용 쿠폰이 쓰였으면 확실
 *   ② 전화번호 — 수취인(없으면 구매자) 연락처가 발송 대상과 일치 (수취인=구매자 가정)
 *   ③ 이메일   — 영문몰(shop_no=2) 은 문자를 못 받아 이메일로 보냈으니 구매자 이메일로 대조
 * 링크 클릭 여부는 참고값으로만 둔다(클릭 없이 검색 유입해 사는 경우가 많다).
 *
 * 몰은 캠페인의 brand 로 고른다(없으면 폴바이스). 2026-09-13 전엔 폴바이스 몰·전화만 봐서
 * 해리엇 설월 캠페인이 전환 0 으로 나왔다. 국문몰(shop 1)·영문몰(shop 2)을 모두 훑고,
 * 영문몰 USD 결제는 손익 설정 환율(getUsdToKrw)로 원화 환산해 매출로 적는다.
 *
 * POST /api/crm/campaigns/attribute { campaignId, sinceHours?, confirm }
 *   confirm 없으면 매칭 결과만 보여주고 쓰지 않는다.
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCampaign, markPurchase } from "@/lib/crm/campaign";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getUsdToKrw } from "@/lib/finance/forex";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface OrderItem { product_no?: number; product_price?: string; quantity?: number; order_status?: string }
interface Order {
  order_id: string; payment_date?: string; canceled?: string;
  actual_payment_amount?: string; payment_amount?: string;
  member_email?: string;
  buyer?: { email?: string; cellphone?: string; phone?: string };
  items?: OrderItem[];
  receivers?: Array<{ cellphone?: string; phone?: string }>;
}
interface Target { code: string; phone?: string | null; email?: string | null; name?: string | null }

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();

export async function POST(req: NextRequest) {
  let b: { campaignId?: string; sinceHours?: number; confirm?: boolean };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 }); }
  if (!b.campaignId) return Response.json({ ok: false, error: "campaignId 필요" }, { status: 400 });

  const campaign = await getCampaign(b.campaignId);
  if (!campaign) return Response.json({ ok: false, error: "캠페인 없음" }, { status: 404 });
  const brand = campaign.brand ?? "paulvice";

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "KV 미설정" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 미구매 대상만 대조 대상
  const { data: targets } = await sb.from("crm_campaign_targets")
    .select("code, phone, email, name").eq("campaign_id", b.campaignId).is("purchased_at", null);
  const byPhone = new Map<string, Target>();
  const byEmail = new Map<string, Target>();
  for (const t of (targets ?? []) as Target[]) {
    if (t.phone) byPhone.set(digits(t.phone), t);
    if (t.email) byEmail.set(lower(t.email), t);
  }
  if (!byPhone.size && !byEmail.size) return Response.json({ ok: true, matched: 0, note: "미구매 대상 없음" });

  const token = await getValidC24Token(brand);
  if (!token) return Response.json({ ok: false, error: `카페24 토큰 없음(${brand})` }, { status: 502 });
  const mall = brand === "harriot" ? process.env.HARRIOT_CAFE24_MALL_ID : process.env.CAFE24_MALL_ID;
  if (!mall) return Response.json({ ok: false, error: `몰 ID 미설정(${brand})` }, { status: 500 });
  const usdToKrw = await getUsdToKrw();

  const sinceMs = Date.now() - (b.sinceHours ?? 24 * 14) * 3600_000;
  const start = new Date(Math.max(sinceMs, new Date(campaign.sentAt || campaign.createdAt).getTime())).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); // KST 오늘
  const H = { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": "2026-03-01" };

  const hits: Array<{ code: string; name?: string | null; orderId: string; revenue: number; how: "phone" | "email"; shop: number }> = [];
  for (const shop of [1, 2]) {
    for (let page = 1; page <= 20; page++) {
      const u = `https://${mall}.cafe24api.com/api/v2/admin/orders?shop_no=${shop}&start_date=${start}&end_date=${end}&limit=100&offset=${(page - 1) * 100}&embed=items,receivers,buyer&date_type=pay_date`;
      const r = await fetch(u, { headers: H });
      if (!r.ok) break;
      const j = (await r.json()) as { orders?: Order[] };
      const orders = j.orders ?? [];
      for (const o of orders) {
        if (o.canceled === "T") continue;
        // 캠페인 상품이 지정돼 있으면 그 상품이 담긴 주문만 귀속(다른 상품 구매를 캠페인 성과로 세지 않는다)
        if (campaign.productNo && !(o.items ?? []).some((it) => Number(it.product_no) === campaign.productNo)) continue;
        const phone = digits(o.receivers?.[0]?.cellphone || o.receivers?.[0]?.phone || o.buyer?.cellphone);
        const email = lower(o.buyer?.email || o.member_email);
        let t = phone ? byPhone.get(phone) : undefined; let how: "phone" | "email" = "phone";
        if (!t && email) { t = byEmail.get(email); how = "email"; }
        if (!t) continue;
        const paid = Number(o.actual_payment_amount || o.payment_amount || 0);
        // 영문몰(shop 2)은 USD 결제 — 손익과 같은 환율로 원화 환산(단일 기준 환율, 일별 실환율 아님)
        const revenue = shop === 2 ? Math.round(paid * usdToKrw) : paid;
        hits.push({ code: t.code, name: t.name, orderId: o.order_id, revenue, how, shop });
        if (t.phone) byPhone.delete(digits(t.phone));
        if (t.email) byEmail.delete(lower(t.email));
      }
      if (orders.length < 100) break;
    }
  }

  if (!b.confirm) {
    return Response.json({
      ok: true, dryRun: true, brand, matched: hits.length,
      preview: hits.slice(0, 20).map((h) => ({ name: h.name, orderId: h.orderId, revenue: h.revenue, how: h.how, shop: h.shop })),
    });
  }
  let n = 0;
  for (const h of hits) {
    if (await markPurchase(h.code, null, { orderId: h.orderId, revenue: h.revenue, attribution: h.how })) n++;
  }
  return Response.json({ ok: true, brand, matched: hits.length, applied: n });
}
