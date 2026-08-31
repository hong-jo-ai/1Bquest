/**
 * 소재(광고)별 성과 — 대시보드 광고 섹션이 쓰는 집계.
 *
 * 데이터는 이미 sync 가 `mads_ads` + `mads_ad_daily_metrics` 에 쌓고 있다(계정당 2콜).
 * 그동안 DB 에만 있고 화면에 없어서, "후킹 문구가 나은가 착용컷이 나은가" 같은 질문에
 * 감으로 답하고 있었다(2026-08-30). Meta 를 다시 치지 않고 DB 만 읽는다.
 *
 * ⚠️ CTR 로 소재를 고르면 안 된다. 실측에서 CTR 10.1% 소재의 ROAS 가 0.50,
 *    CTR 6.5% 소재의 ROAS 가 6.89 였다 — **클릭 잘 나오는 소재와 파는 소재가 다르다.**
 *    그래서 두 값을 나란히 보여준다.
 */
import { getCsSupabase } from "@/lib/cs/store";
import { campaignMatchesBrand, type Brand } from "@/lib/metaBrandFilter";
import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface Row {
  metaAdId: string;
  name: string;
  status: string;
  format: string | null;
  thumbnail: string | null;
  campaignName: string | null;
  spend: number;
  revenue: number;
  conversions: number;
  impressions: number;
  clicks: number;
  roas: number | null;
  ctr: number | null;
  cpa: number | null;
  days: number;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = (sp.get("brand") === "harriot" ? "harriot" : "paulvice") as Brand;
  const days = Math.min(90, Math.max(1, Number(sp.get("days")) || 14));
  const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

  try {
    const db = getCsSupabase();
    const [adsQ, metricsQ, adsetsQ] = await Promise.all([
      db.from("mads_ads").select("meta_ad_id,meta_adset_id,name,effective_status,creative_format,thumbnail_url"),
      db.from("mads_ad_daily_metrics")
        .select("meta_ad_id,date,spend,revenue,conversions,impressions,clicks").gte("date", since),
      // 브랜드 판별은 캠페인 이름으로 한다 — 계정이 하나뿐이고 두 브랜드가 섞여 있다.
      db.from("mads_ad_sets").select("meta_adset_id,campaign_name"),
    ]);
    if (adsQ.error) throw new Error(adsQ.error.message);
    if (metricsQ.error) throw new Error(metricsQ.error.message);

    const campaignByAdset = new Map<string, string>();
    for (const a of adsetsQ.data ?? []) campaignByAdset.set(a.meta_adset_id, a.campaign_name ?? "");

    type Acc = { spend: number; revenue: number; conversions: number; impressions: number; clicks: number; dates: Set<string> };
    const agg = new Map<string, Acc>();
    for (const m of metricsQ.data ?? []) {
      const a = agg.get(m.meta_ad_id) ?? { spend: 0, revenue: 0, conversions: 0, impressions: 0, clicks: 0, dates: new Set<string>() };
      a.spend += Number(m.spend ?? 0);
      a.revenue += Number(m.revenue ?? 0);
      a.conversions += Number(m.conversions ?? 0);
      a.impressions += Number(m.impressions ?? 0);
      a.clicks += Number(m.clicks ?? 0);
      a.dates.add(m.date);
      agg.set(m.meta_ad_id, a);
    }

    const rows: Row[] = [];
    for (const ad of adsQ.data ?? []) {
      const a = agg.get(ad.meta_ad_id);
      if (!a || a.spend <= 0) continue;                  // 지출 없는 소재는 비교 대상이 아니다
      const campaignName = campaignByAdset.get(ad.meta_adset_id) ?? null;
      // 캠페인명으로 브랜드를 못 가르면(이름 규칙 밖) 폴바이스로 떨어지므로, 해리엇 조회 시엔 누락될 수 있다.
      if (!campaignMatchesBrand(campaignName ?? ad.name, brand)) continue;
      rows.push({
        metaAdId: ad.meta_ad_id,
        name: ad.name ?? "",
        status: ad.effective_status ?? "UNKNOWN",
        format: ad.creative_format ?? null,
        thumbnail: ad.thumbnail_url ?? null,
        campaignName,
        spend: a.spend, revenue: a.revenue, conversions: a.conversions,
        impressions: a.impressions, clicks: a.clicks,
        roas: a.spend > 0 ? a.revenue / a.spend : null,
        ctr: a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null,
        cpa: a.conversions > 0 ? a.spend / a.conversions : null,
        days: a.dates.size,
      });
    }
    rows.sort((x, y) => y.spend - x.spend);

    const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
    const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
    return Response.json({
      ok: true, brand, days,
      totals: { spend: totalSpend, revenue: totalRev, roas: totalSpend > 0 ? totalRev / totalSpend : null, creatives: rows.length },
      rows,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
