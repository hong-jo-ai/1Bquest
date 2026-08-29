/**
 * CRM 현황 한 장 — /crm 페이지가 쓰는 집계.
 *
 * 세 갈래를 한 번에 본다:
 *   ① CARE 등록  — 카드에서 걸어 들어온 사람들(채널별·동의율·쿠폰)
 *   ② 캠페인     — 문자 발송 퍼널(발송→클릭→장바구니→구매)
 *   ③ 모수       — 지금 연락 가능한 사람이 몇 명인가(브랜드·채널별)
 *
 * "얼마나 모였나"보다 **"연락 가능한 사람이 늘고 있나"** 가 이 화면의 질문이다.
 */
import { createClient } from "@supabase/supabase-js";
import { listCampaigns, funnelOf, buildLeads } from "@/lib/crm/campaign";

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
    // ① CARE 등록
    const { data: regs } = await sb.from("care_registrations")
      .select("phone,product_name,ad_consent,source,coupon_code,battery_used_at,registered_at")
      .order("registered_at", { ascending: false });
    const rows = (regs ?? []) as Array<{
      phone: string; product_name: string | null; ad_consent: boolean;
      source: string | null; coupon_code: string | null; battery_used_at: string | null; registered_at: string;
    }>;
    const now = Date.now();
    const since = (d: number) => rows.filter((r) => now - new Date(r.registered_at).getTime() < d * 86400000).length;
    const byChannel: Record<string, { total: number; consent: number }> = {};
    for (const r of rows) {
      // source 는 "card/무신사" 형태 — 뒤쪽이 실제 구매 채널
      const ch = (r.source ?? "").split("/").pop() || "미확인";
      const c = byChannel[ch] ?? { total: 0, consent: 0 };
      c.total++; if (r.ad_consent) c.consent++;
      byChannel[ch] = c;
    }
    const consent = rows.filter((r) => r.ad_consent).length;

    // 쿠폰 시리얼 재고
    const [{ count: serialTotal }, { count: serialFree }] = await Promise.all([
      sb.from("care_coupon_serials").select("*", { count: "exact", head: true }),
      sb.from("care_coupon_serials").select("*", { count: "exact", head: true }).is("assigned_at", null),
    ]);

    // ② 캠페인 퍼널
    const campaigns = await listCampaigns();
    const funnels = await Promise.all(
      campaigns.slice(0, 5).map(async (c) => ({ id: c.id, name: c.name, sentAt: c.sentAt, funnel: await funnelOf(c.id) })),
    );

    // ③ 지금 연락 가능한 모수
    const [pv, hr] = await Promise.all([
      buildLeads({ brand: "paulvice", sinceDays: 180, waitlistKey: null }),
      buildLeads({ brand: "harriot", sinceDays: 180, waitlistKey: "harriot:seolwol:waitlist:v1" }),
    ]);

    return Response.json({
      ok: true,
      care: {
        total: rows.length, today: since(1), week: since(7), month: since(30),
        consent, consentRate: rows.length ? consent / rows.length : 0,
        batteryUsed: rows.filter((r) => r.battery_used_at).length,
        byChannel,
        recent: rows.slice(0, 12).map((r) => ({
          phone: r.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2"),
          product: r.product_name, consent: r.ad_consent,
          channel: (r.source ?? "").split("/").pop() || "미확인",
          at: r.registered_at,
        })),
      },
      coupon: { total: serialTotal ?? 0, free: serialFree ?? 0, used: (serialTotal ?? 0) - (serialFree ?? 0) },
      campaigns: funnels,
      reachable: {
        paulvice: pv.length, harriot: hr.length,
        harriotEmail: hr.filter((l) => l.channel === "email").length,
      },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
