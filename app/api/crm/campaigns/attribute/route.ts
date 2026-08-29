/**
 * 캠페인 구매 귀속 — 발송 이후 들어온 카페24 주문을 캠페인 대상과 대조해 purchased 로 채운다.
 *
 * 귀속 우선순위 (정확도 순)
 *   ① 쿠폰코드 — 주문에 캠페인 전용 쿠폰이 쓰였으면 확실
 *   ② 전화번호 — 수취인 연락처가 발송 대상과 일치 (수취인=구매자 가정)
 * 링크 클릭 여부는 참고값으로만 둔다(클릭 없이 검색 유입해 사는 경우가 많다).
 *
 * POST /api/crm/campaigns/attribute { campaignId, sinceHours?, confirm }
 *   confirm 없으면 매칭 결과만 보여주고 쓰지 않는다.
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCampaign, markPurchase } from "@/lib/crm/campaign";
import { getValidC24Token } from "@/lib/cafe24Auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface OrderItem { product_no?: number; product_price?: string; quantity?: number; order_status?: string }
interface Order {
  order_id: string; payment_date?: string; canceled?: string;
  actual_payment_amount?: string; payment_amount?: string;
  items?: OrderItem[];
  receivers?: Array<{ cellphone?: string; phone?: string }>;
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export async function POST(req: NextRequest) {
  let b: { campaignId?: string; sinceHours?: number; confirm?: boolean };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 }); }
  if (!b.campaignId) return Response.json({ ok: false, error: "campaignId 필요" }, { status: 400 });

  const campaign = await getCampaign(b.campaignId);
  if (!campaign) return Response.json({ ok: false, error: "캠페인 없음" }, { status: 404 });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "KV 미설정" }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 미구매 대상만 대조 대상
  const { data: targets } = await sb.from("crm_campaign_targets")
    .select("code, phone, name").eq("campaign_id", b.campaignId).is("purchased_at", null);
  const byPhone = new Map<string, { code: string; name?: string }>();
  for (const t of (targets ?? []) as Array<{ code: string; phone: string; name?: string }>) {
    if (t.phone) byPhone.set(digits(t.phone), { code: t.code, name: t.name });
  }
  if (!byPhone.size) return Response.json({ ok: true, matched: 0, note: "미구매 대상 없음" });

  const token = await getValidC24Token("paulvice");
  if (!token) return Response.json({ ok: false, error: "카페24 토큰 없음" }, { status: 502 });

  const sinceMs = Date.now() - (b.sinceHours ?? 24 * 14) * 3600_000;
  const start = new Date(Math.max(sinceMs, new Date(campaign.sentAt || campaign.createdAt).getTime())).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const mall = process.env.CAFE24_MALL_ID;
  const H = { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": "2026-03-01" };

  const hits: Array<{ code: string; name?: string; orderId: string; revenue: number }> = [];
  for (let page = 1; page <= 20; page++) {
    const u = `https://${mall}.cafe24api.com/api/v2/admin/orders?start_date=${start}&end_date=${end}&limit=100&offset=${(page - 1) * 100}&embed=items,receivers&date_type=pay_date`;
    const r = await fetch(u, { headers: H });
    if (!r.ok) break;
    const j = (await r.json()) as { orders?: Order[] };
    const orders = j.orders ?? [];
    for (const o of orders) {
      if (o.canceled === "T") continue;
      const phone = digits(o.receivers?.[0]?.cellphone || o.receivers?.[0]?.phone);
      const t = phone ? byPhone.get(phone) : undefined;
      if (!t) continue;
      // 캠페인 상품이 지정돼 있으면 그 상품이 담긴 주문만 귀속(다른 상품 구매를 캠페인 성과로 세지 않는다)
      if (campaign.productNo && !(o.items ?? []).some((it) => Number(it.product_no) === campaign.productNo)) continue;
      const revenue = Number(o.actual_payment_amount || o.payment_amount || 0);
      hits.push({ code: t.code, name: t.name, orderId: o.order_id, revenue });
      byPhone.delete(phone);
    }
    if (orders.length < 100) break;
  }

  if (!b.confirm) {
    return Response.json({
      ok: true, dryRun: true, matched: hits.length,
      preview: hits.slice(0, 20).map((h) => ({ name: h.name, orderId: h.orderId, revenue: h.revenue })),
    });
  }
  let n = 0;
  for (const h of hits) {
    if (await markPurchase(h.code, null, { orderId: h.orderId, revenue: h.revenue, attribution: "phone" })) n++;
  }
  return Response.json({ ok: true, matched: hits.length, applied: n });
}
