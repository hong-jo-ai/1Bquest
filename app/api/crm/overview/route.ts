/**
 * CRM 현황 한 장 — 대시보드 CRM 섹션이 쓰는 집계.
 *
 * 광고관리자와 같은 질문에 답한다: **얼마 써서 얼마 벌었나.**
 *   ① 성과   — 기여매출 / 비용 / ROAS / 전환수 / 전환당비용
 *   ② 캠페인 — 발송·클릭·전환·매출을 캠페인별 한 행(광고세트 표와 같은 모양)
 *   ③ CARE   — 카드 배포 → 등록 → 자사몰 구매까지의 퍼널과 단가
 *   ④ 모수   — 지금 연락 가능한 사람 수(다음 캠페인의 상한)
 *
 * 계산은 전부 lib/crm/metrics.ts 에 있다. 이 라우트는 조립만 한다.
 */
import { createClient } from "@supabase/supabase-js";
import { buildLeads } from "@/lib/crm/campaign";
import { crmTotals } from "@/lib/crm/metrics";
import { popupStats } from "@/lib/storefront/popup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function db() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

export async function GET() {
  const sb = db();
  if (!sb) return Response.json({ ok: false, error: "KV 미설정" }, { status: 500 });
  try {
    const [{ totals, campaigns, care }, serials, recent, pv, hr, cart, popup] = await Promise.all([
      crmTotals(),
      Promise.all([
        sb.from("care_coupon_serials").select("*", { count: "exact", head: true }),
        sb.from("care_coupon_serials").select("*", { count: "exact", head: true }).is("assigned_at", null),
      ]),
      sb.from("care_registrations")
        .select("phone,product_name,ad_consent,source,registered_at,orders,revenue")
        .order("registered_at", { ascending: false }).limit(12),
      buildLeads({ brand: "paulvice", sinceDays: 180, waitlistKey: null }),
      buildLeads({ brand: "harriot", sinceDays: 180, waitlistKey: "harriot:seolwol:waitlist:v1" }),
      // 장바구니 — 담기 대비 구매. 비로그인 수집은 2026-08-30 부터라 그 전 숫자는 회원분뿐이다.
      sb.from("crm_cart_events").select("member_id,anon_id,status,converted_at,cart_at")
        .gte("cart_at", new Date(Date.now() - 30 * 86400000).toISOString()),
      popupStats(14).catch(() => null),
    ]);

    const [{ count: serialTotal }, { count: serialFree }] = serials;
    type Cart = { member_id: string | null; anon_id: string | null; status: string; converted_at: string | null };
    const cartRows = (cart.data ?? []) as Cart[];
    const carted = cartRows.length;
    const cartConverted = cartRows.filter((r) => r.converted_at).length;
    type Reg = { phone: string; product_name: string | null; ad_consent: boolean; source: string | null; registered_at: string; orders: number | null; revenue: number | null };

    return Response.json({
      ok: true,
      totals,
      campaigns,
      care,
      coupon: { total: serialTotal ?? 0, free: serialFree ?? 0, used: (serialTotal ?? 0) - (serialFree ?? 0) },
      recent: ((recent.data ?? []) as Reg[]).map((r) => ({
        phone: r.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2"),
        product: r.product_name,
        consent: r.ad_consent,
        channel: (r.source ?? "").split("/").pop() || "미확인",
        at: r.registered_at,
        orders: r.orders ?? 0,
        revenue: Number(r.revenue ?? 0),
      })),
      popup,
      cart: {
        carted,
        converted: cartConverted,
        rate: carted ? cartConverted / carted : 0,
        members: cartRows.filter((r) => r.member_id).length,
        guests: cartRows.filter((r) => !r.member_id && r.anon_id).length,
      },
      reachable: {
        paulvice: pv.length,
        harriot: hr.length,
        harriotEmail: hr.filter((l) => l.channel === "email").length,
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
