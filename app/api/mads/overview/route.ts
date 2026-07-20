/**
 * MADS 현황판 데이터 — 계정 → 캠페인 → 광고세트 → 개별 광고 계층 + 일별 메트릭.
 * Meta API를 직접 치지 않고 sync가 쌓아둔 DB만 읽는다(빠름). 최신화는 sync/평가 버튼.
 */
import { getCsSupabase } from "@/lib/cs/store";
import { getMarginConfig, resolveThresholds } from "@/lib/mads/marginConfig";
import { getActiveSeasonModifier } from "@/lib/mads/seasonModifier";
import { normalizeAdAccountId } from "@/lib/metaBrandFilter";

export const dynamic = "force-dynamic";

interface DayPoint {
  date: string;
  spend: number;
  revenue: number;
  conversions: number;
  ctr: number | null;
  cpm: number | null;
  frequency: number | null;
}

function agg(days: DayPoint[]) {
  const spend = days.reduce((s, d) => s + d.spend, 0);
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  const conversions = days.reduce((s, d) => s + d.conversions, 0);
  return { spend, revenue, conversions, roas: spend > 0 ? revenue / spend : 0 };
}

export async function GET() {
  try {
    const db = getCsSupabase();
    const sinceDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

    const [adsetsQ, metricsQ, adsQ, adMetricsQ, marginCfg, seasonMod] = await Promise.all([
      db.from("mads_ad_sets").select("*").order("meta_account_id"),
      db.from("mads_daily_metrics").select("*").gte("date", sinceDate),
      db.from("mads_ads").select("*"),
      db.from("mads_ad_daily_metrics").select("*").gte("date", sinceDate),
      getMarginConfig(),
      getActiveSeasonModifier(),
    ]);
    if (adsetsQ.error) throw new Error(adsetsQ.error.message);
    if (metricsQ.error) throw new Error(metricsQ.error.message);
    if (adsQ.error) throw new Error(adsQ.error.message);
    if (adMetricsQ.error) throw new Error(adMetricsQ.error.message);

    const thresholds = resolveThresholds(marginCfg, seasonMod);

    // 광고세트별 일별
    const byAdset = new Map<string, DayPoint[]>();
    for (const m of metricsQ.data ?? []) {
      const arr = byAdset.get(m.meta_adset_id) ?? [];
      arr.push({
        date: m.date, spend: Number(m.spend), revenue: Number(m.revenue),
        conversions: m.conversions, ctr: m.ctr === null ? null : Number(m.ctr),
        cpm: m.cpm === null ? null : Number(m.cpm),
        frequency: m.frequency === null ? null : Number(m.frequency),
      });
      byAdset.set(m.meta_adset_id, arr);
    }

    // 개별 광고별 일별
    const byAd = new Map<string, DayPoint[]>();
    for (const m of adMetricsQ.data ?? []) {
      const arr = byAd.get(m.meta_ad_id) ?? [];
      arr.push({
        date: m.date, spend: Number(m.spend), revenue: Number(m.revenue),
        conversions: m.conversions, ctr: m.ctr === null ? null : Number(m.ctr),
        cpm: m.cpm === null ? null : Number(m.cpm),
        frequency: m.frequency === null ? null : Number(m.frequency),
      });
      byAd.set(m.meta_ad_id, arr);
    }

    // 광고를 세트별로 묶기
    const adsByAdset = new Map<string, unknown[]>();
    for (const ad of adsQ.data ?? []) {
      const days = (byAd.get(ad.meta_ad_id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const t7 = agg(days);
      const today = days.find((d) => d.date === todayKst);
      const latest = days[days.length - 1];
      // 소재 피로: 빈도 2.5+ 이면서 최근 3일 CTR이 이전 4일 대비 25%+ 하락
      const firstHalf = days.slice(0, Math.max(0, days.length - 3)).filter((d) => d.ctr !== null);
      const lastHalf = days.slice(-3).filter((d) => d.ctr !== null);
      const avgCtr = (xs: DayPoint[]) => xs.length ? xs.reduce((s, d) => s + (d.ctr ?? 0), 0) / xs.length : null;
      const ctrBefore = avgCtr(firstHalf), ctrRecent = avgCtr(lastHalf);
      const fatigued = (latest?.frequency ?? 0) >= 2.5 &&
        ctrBefore !== null && ctrRecent !== null && ctrBefore > 0 && ctrRecent < ctrBefore * 0.75;

      const row = {
        metaAdId: ad.meta_ad_id,
        name: ad.name,
        effectiveStatus: ad.effective_status,
        creativeFormat: ad.creative_format,
        thumbnailUrl: ad.thumbnail_url,
        spend7d: t7.spend, revenue7d: t7.revenue, roas7d: t7.roas, conversions7d: t7.conversions,
        spendToday: today?.spend ?? 0,
        ctrRecent, frequency: latest?.frequency ?? null,
        fatigued,
        days,
      };
      const arr = adsByAdset.get(ad.meta_adset_id) ?? [];
      arr.push(row);
      adsByAdset.set(ad.meta_adset_id, arr);
    }

    // 계층 조립: 계정 → 캠페인 → 광고세트
    interface AdsetRow {
      metaAdsetId: string; name: string; status: string; funnelStage: string;
      dailyBudget: number | null; campaignId: string | null; campaignName: string | null;
      spendToday: number; spend7d: number; revenue7d: number; roas7d: number;
      conversions7d: number; ctr7d: number | null; cpmLatest: number | null; frequencyLatest: number | null;
      days: DayPoint[]; ads: unknown[];
    }
    // 운영 계정만 표시 (사장님 2026-07-20: 해리엇 광고계정만 사용) — env 미설정 시 전체.
    const onlyAccount = normalizeAdAccountId(process.env.META_AD_ACCOUNT_ID);
    // 휴면 제외: 활성이 아니고 7일 지출도 없는 세트는 숨김(볼 데이터가 없음).
    let hiddenDormant = 0;

    interface AccountBlock { accountId: string; accountName: string; adsets: AdsetRow[] }
    const accounts = new Map<string, AccountBlock>();
    for (const s of adsetsQ.data ?? []) {
      if (onlyAccount && s.meta_account_id !== onlyAccount) continue;
      const days = (byAdset.get(s.meta_adset_id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const t7 = agg(days);
      const today = days.find((d) => d.date === todayKst);
      const latest = days[days.length - 1];
      const impDays = days.filter((d) => d.ctr !== null);
      const ctr7d = impDays.length ? impDays.reduce((x, d) => x + (d.ctr ?? 0), 0) / impDays.length : null;

      const row: AdsetRow = {
        metaAdsetId: s.meta_adset_id,
        name: s.name, status: s.status, funnelStage: s.funnel_stage,
        dailyBudget: s.daily_budget === null ? null : Number(s.daily_budget),
        campaignId: s.campaign_id, campaignName: s.campaign_name,
        spendToday: today?.spend ?? 0,
        spend7d: t7.spend, revenue7d: t7.revenue, roas7d: t7.roas, conversions7d: t7.conversions,
        ctr7d, cpmLatest: latest?.cpm ?? null, frequencyLatest: latest?.frequency ?? null,
        days,
        ads: (adsByAdset.get(s.meta_adset_id) ?? []).sort(
          (a, b) => (b as { spend7d: number }).spend7d - (a as { spend7d: number }).spend7d),
      };
      if (row.spend7d <= 0 && s.status !== "ACTIVE") { hiddenDormant++; continue; }
      const acc: AccountBlock = accounts.get(s.meta_account_id) ?? {
        accountId: s.meta_account_id, accountName: s.account_name ?? s.meta_account_id, adsets: [] as AdsetRow[],
      };
      acc.adsets.push(row);
      accounts.set(s.meta_account_id, acc);
    }

    const out = [...accounts.values()].map((acc) => {
      const active = acc.adsets.filter((a) => a.status === "ACTIVE");
      const spendToday = active.reduce((s, a) => s + a.spendToday, 0);
      const spend7d = acc.adsets.reduce((s, a) => s + a.spend7d, 0);
      const revenue7d = acc.adsets.reduce((s, a) => s + a.revenue7d, 0);
      acc.adsets.sort((a, b) => (b.status === "ACTIVE" ? 1 : 0) - (a.status === "ACTIVE" ? 1 : 0) || b.spend7d - a.spend7d);
      return {
        ...acc,
        totals: { spendToday, spend7d, revenue7d, roas7d: spend7d > 0 ? revenue7d / spend7d : 0, activeAdsets: active.length },
      };
    });

    return Response.json({ ok: true, accounts: out, beRoas: thresholds.beRoas, today: todayKst, hiddenDormant });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
