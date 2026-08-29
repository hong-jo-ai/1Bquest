/**
 * CARE 매출 귀속 — 등록한 사람이 그 뒤 자사몰에서 실제로 샀는지 채운다.
 *
 * CARE 의 목적은 "등록 수"가 아니다. 마켓에서 산 사람을 자사몰 고객으로
 * 옮겨 앉히는 것이다. 그 성패는 등록 **이후** 자사몰 주문이 있느냐로만 확인된다.
 *
 * 귀속 규칙
 *   - 등록 시각 **이후** 결제된 카페24 주문만 센다(등록 전 주문은 CARE 성과가 아니다).
 *   - 수취인 휴대폰 = 등록 휴대폰. 구매자와 수취인이 다른 선물 주문은 놓친다(과소 집계).
 *   - 취소 주문 제외.
 *   - 쿠폰할인이 붙은 주문이면 coupon_used_at 을 남긴다. 단 CARE 스트랩 쿠폰인지
 *     주문 API 로는 특정할 수 없어 **"쿠폰 쓴 주문"까지만** 말한다(다른 쿠폰일 수 있다).
 *
 * GET  → 크론용(전량 재계산). POST { confirm } → 수동 실행.
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getValidC24Token } from "@/lib/cafe24Auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Order {
  order_id: string; payment_date?: string; canceled?: string;
  actual_payment_amount?: string; payment_amount?: string;
  order_coupon_discount_price?: string;
  receivers?: Array<{ cellphone?: string; phone?: string }>;
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export async function run(lookbackDays = 120) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false as const, error: "KV 미설정" };
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: regs } = await sb.from("care_registrations").select("id,phone,registered_at");
  const rows = (regs ?? []) as Array<{ id: string; phone: string; registered_at: string }>;
  if (!rows.length) return { ok: true as const, registrations: 0, matched: 0, note: "등록자 없음" };

  const byPhone = new Map<string, { id: string; registeredAt: string }>();
  for (const r of rows) byPhone.set(digits(r.phone), { id: r.id, registeredAt: r.registered_at });

  const token = await getValidC24Token("paulvice");
  if (!token) return { ok: false as const, error: "카페24 토큰 없음" };
  const mall = process.env.CAFE24_MALL_ID;
  const H = { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": "2026-03-01" };

  // 가장 오래된 등록일부터 훑되, 너무 멀리는 안 간다(주문 API 페이지 수 = 시간).
  const oldest = rows.reduce((a, r) => (r.registered_at < a ? r.registered_at : a), rows[0].registered_at);
  const floor = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const start = (oldest > floor ? oldest : floor).slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);

  // phone → 집계
  const agg = new Map<string, { orders: number; revenue: number; first: string; last: string; coupon: string | null }>();
  for (let page = 1; page <= 40; page++) {
    const u = `https://${mall}.cafe24api.com/api/v2/admin/orders`
      + `?start_date=${start}&end_date=${end}&limit=100&offset=${(page - 1) * 100}`
      + `&embed=receivers&date_type=pay_date`;
    const r = await fetch(u, { headers: H });
    if (!r.ok) break;
    const orders = ((await r.json()) as { orders?: Order[] }).orders ?? [];
    for (const o of orders) {
      if (o.canceled === "T") continue;
      const phone = digits(o.receivers?.[0]?.cellphone || o.receivers?.[0]?.phone);
      const reg = phone ? byPhone.get(phone) : undefined;
      if (!reg) continue;
      const paid = o.payment_date ?? "";
      if (!paid || paid <= reg.registeredAt) continue;    // 등록 이전 주문은 성과가 아니다
      const rev = Number(o.actual_payment_amount || o.payment_amount || 0);
      const cur = agg.get(phone) ?? { orders: 0, revenue: 0, first: paid, last: paid, coupon: null };
      cur.orders++; cur.revenue += rev;
      if (paid < cur.first) cur.first = paid;
      if (paid > cur.last) cur.last = paid;
      if (!cur.coupon && Number(o.order_coupon_discount_price || 0) > 0) cur.coupon = paid;
      agg.set(phone, cur);
    }
    if (orders.length < 100) break;
  }

  const now = new Date().toISOString();
  let matched = 0;
  for (const [phone, a] of agg) {
    const reg = byPhone.get(phone)!;
    await sb.from("care_registrations").update({
      orders: a.orders, revenue: a.revenue,
      first_order_at: a.first, last_order_at: a.last,
      coupon_used_at: a.coupon, attributed_at: now,
    }).eq("id", reg.id);
    matched++;
  }
  // 매칭 안 된 등록자도 "확인했다"는 사실은 남긴다 — 안 그러면 미계산과 구매0을 구분 못 한다.
  const unmatched = rows.filter((r) => !agg.has(digits(r.phone))).map((r) => r.id);
  for (let i = 0; i < unmatched.length; i += 200) {
    await sb.from("care_registrations").update({ attributed_at: now }).in("id", unmatched.slice(i, i + 200));
  }

  return {
    ok: true as const,
    registrations: rows.length, matched,
    revenue: [...agg.values()].reduce((a, v) => a + v.revenue, 0),
    window: `${start} ~ ${end}`,
  };
}

export async function GET() {
  return Response.json(await run());
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { lookbackDays?: number };
  return Response.json(await run(b.lookbackDays ?? 120));
}
