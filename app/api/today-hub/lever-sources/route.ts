import { type NextRequest } from "next/server";
import { computeCampaignMetrics } from "@/lib/campaigns/metrics";
import { listCampaigns } from "@/lib/campaigns/store";
import { listIgAccounts } from "@/lib/cs/instagramClient";
import { campaignMatchesBrand, resolveAdAccountId } from "@/lib/metaBrandFilter";
import { metaGet } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { listUpcomingProducts } from "@/lib/upcomingProducts";
import type { Campaign, CampaignBrand } from "@/lib/campaigns/types";
import type { BrandId } from "@/lib/threadsBrands";

export const dynamic = "force-dynamic";

type Brand = "paulvice" | "harriot";

interface CampaignInsightRow {
  campaign_name?: string;
  spend?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}

interface ThreadRow {
  id: string;
  text?: string;
  timestamp?: string;
  permalink?: string;
}

interface InsightMetric {
  name?: string;
  values?: Array<{ value?: number }>;
}

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function monthStart(): string {
  return kstDateStr(0).slice(0, 8) + "01";
}

function sumPurchaseAction(rows: { action_type: string; value: string }[] | undefined): number {
  if (!rows) return 0;
  let total = 0;
  for (const row of rows) {
    if (PURCHASE_ACTIONS.has(row.action_type)) total = Math.max(total, parseFloat(row.value ?? "0"));
  }
  return total;
}

function matchesUpcomingBrand(raw: string, brand: Brand): boolean {
  const value = raw.trim().toLowerCase();
  if (brand === "harriot") return /해리엇|harriot|harriott/.test(value);
  return /폴바이스|paulvice|paulwise/.test(value);
}

async function getAds(brand: Brand) {
  const token = await getMetaTokenServer();
  if (!token) return { connected: false, error: "Meta 토큰 없음" };

  try {
    const accountId = await resolveAdAccountId(token);
    const since = monthStart();
    const until = kstDateStr(0);
    const ins = (await metaGet(`/${accountId}/insights`, token, {
      fields: "spend,actions,action_values,campaign_name",
      time_range: JSON.stringify({ since, until }),
      level: "campaign",
      limit: "500",
    })) as { data?: CampaignInsightRow[] };

    const rows = (ins.data ?? []).filter((row) => campaignMatchesBrand(row.campaign_name, brand));
    let spend = 0;
    let purchaseValue = 0;
    let purchaseCount = 0;

    for (const row of rows) {
      spend += parseFloat(row.spend ?? "0");
      purchaseValue += sumPurchaseAction(row.action_values);
      purchaseCount += sumPurchaseAction(row.actions);
    }

    return {
      connected: true,
      since,
      until,
      spend: Math.round(spend),
      purchaseValue: Math.round(purchaseValue),
      purchaseCount: Math.round(purchaseCount),
      roas: spend > 0 ? purchaseValue / spend : 0,
      campaignsCounted: rows.length,
    };
  } catch (e) {
    return { connected: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function getInstagramContent(brand: Brand) {
  const accounts = await listIgAccounts().catch(() => []);
  const account = accounts.find((item) => item.brand === brand && item.igUserId && item.pageAccessToken);
  const igUserId = account?.igUserId;
  const token = account?.pageAccessToken;

  if (!token || !igUserId) {
    return {
      connected: false,
      error: "브랜드 Instagram 계정 미연동",
    };
  }

  try {
    const since = monthStart();
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/media?fields=id,timestamp,media_type,like_count,comments_count&limit=25&access_token=${token}`,
      { cache: "no-store", signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return { connected: false, error: `Instagram API ${res.status}` };
    const json = await res.json();
    const posts = Array.isArray(json.data) ? json.data : [];
    const monthPosts = posts.filter((post: { timestamp?: string }) => (post.timestamp ?? "").slice(0, 10) >= since);
    const engagements = monthPosts.reduce(
      (sum: number, post: { like_count?: number; comments_count?: number }) =>
        sum + (post.like_count ?? 0) + (post.comments_count ?? 0),
      0,
    );
    const likes = monthPosts.reduce(
      (sum: number, post: { like_count?: number }) => sum + (post.like_count ?? 0),
      0,
    );
    const comments = monthPosts.reduce(
      (sum: number, post: { comments_count?: number }) => sum + (post.comments_count ?? 0),
      0,
    );

    return {
      connected: true,
      since,
      postsThisMonth: monthPosts.length,
      recentPosts: posts.length,
      engagements,
      likes,
      comments,
    };
  } catch (e) {
    return { connected: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function getThreads(brand: Brand) {
  const token = await getThreadsTokenFromStore(brand as BrandId);
  if (!token) return { connected: false, error: "Threads 토큰 없음" };

  try {
    const since = monthStart();
    const threadsRes = await fetch(
      `https://graph.threads.net/v1.0/me/threads?fields=id,text,timestamp,permalink&limit=50&access_token=${token}`,
      { cache: "no-store", signal: AbortSignal.timeout(6000) },
    );
    if (!threadsRes.ok) return { connected: false, error: `Threads API ${threadsRes.status}` };
    const threadsJson = await threadsRes.json();
    const threads = (Array.isArray(threadsJson.data) ? threadsJson.data : []) as ThreadRow[];

    let postsThisMonth = 0;
    let likes = 0;
    let replies = 0;
    let views = 0;

    for (const thread of threads) {
      if ((thread.timestamp ?? "").slice(0, 10) < since) continue;
      postsThisMonth += 1;
      try {
        const insRes = await fetch(
          `https://graph.threads.net/v1.0/${thread.id}/insights?metric=likes,replies,views&access_token=${token}`,
          { cache: "no-store", signal: AbortSignal.timeout(5000) },
        );
        if (!insRes.ok) continue;
        const insJson = await insRes.json();
        const metrics = (Array.isArray(insJson.data) ? insJson.data : []) as InsightMetric[];
        for (const metric of metrics) {
          const value = metric.values?.[0]?.value ?? 0;
          if (metric.name === "likes") likes += value;
          if (metric.name === "replies") replies += value;
          if (metric.name === "views") views += value;
        }
      } catch {
        // 한 게시물 insight 실패가 전체 콘텐츠 레버를 막지 않게 한다.
      }
    }

    return {
      connected: true,
      since,
      postsThisMonth,
      recentPosts: threads.length,
      likes,
      replies,
      views,
      engagementRate: views > 0 ? Math.round(((likes + replies) / views) * 10000) / 100 : 0,
    };
  } catch (e) {
    return { connected: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function getCampaignPerformance(brand: Brand, campaigns: Campaign[], today: string, currentMonth: string) {
  const measurable = campaigns.filter((campaign) =>
    campaign.startDate <= today &&
    (campaign.startDate.startsWith(currentMonth) || (campaign.endDate ?? today).startsWith(currentMonth) || !campaign.endDate)
  );

  if (brand === "harriot") {
    return {
      connected: false,
      source: "unsupported",
      campaignsMeasured: 0,
      revenue: 0,
      ordersCount: 0,
      avgOrder: 0,
      warnings: measurable.length > 0
        ? ["해리엇 캠페인 매출 자동 매칭은 아직 식스샵/스마트스토어 주문 원천이 없어 미지원입니다."]
        : [],
    };
  }

  const results = await Promise.all(
    measurable.map(async (campaign) => {
      try {
        return await computeCampaignMetrics(campaign);
      } catch (e) {
        return {
          campaignId: campaign.id,
          windowStart: campaign.startDate,
          windowEnd: today,
          ordersCount: 0,
          revenue: 0,
          avgOrder: 0,
          buyers: [],
          matchedBy: "none" as const,
          warning: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  const revenue = results.reduce((sum, result) => sum + result.revenue, 0);
  const ordersCount = results.reduce((sum, result) => sum + result.ordersCount, 0);
  const warnings = results.map((result) => result.warning).filter((warning): warning is string => !!warning);

  return {
    connected: true,
    source: "cafe24",
    campaignsMeasured: results.length,
    revenue,
    ordersCount,
    avgOrder: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
    warnings,
  };
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand");
  if (brand !== "paulvice" && brand !== "harriot") {
    return Response.json({ ok: false, error: "brand 필수 (paulvice/harriot)" }, { status: 400 });
  }

  const today = kstDateStr(0);
  const currentMonth = today.slice(0, 7);

  try {
    const [upcomingProducts, campaigns, ads, instagram, threads] = await Promise.all([
      listUpcomingProducts(),
      listCampaigns(brand as CampaignBrand),
      getAds(brand),
      getInstagramContent(brand),
      getThreads(brand),
    ]);

    const products = upcomingProducts
      .filter((product) => product.status === "tracking" && matchesUpcomingBrand(product.brand, brand))
      .map((product) => {
        const nextMilestone = [...product.milestones]
          .filter((milestone) => !milestone.done)
          .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
        return {
          id: product.id,
          name: product.name,
          nextMilestone,
          launchDate: product.milestones.length
            ? [...product.milestones].sort((a, b) => b.date.localeCompare(a.date))[0].date
            : null,
          doneMilestones: product.milestones.filter((milestone) => milestone.done).length,
          totalMilestones: product.milestones.length,
        };
      })
      .sort((a, b) => (a.nextMilestone?.date ?? "9999").localeCompare(b.nextMilestone?.date ?? "9999"));

    const activeCampaigns = campaigns.filter((campaign) => !campaign.endDate || campaign.endDate >= today);
    const monthlyCampaigns = campaigns.filter((campaign) =>
      campaign.startDate.startsWith(currentMonth) || (campaign.endDate ?? "").startsWith(currentMonth)
    );
    const campaignPerformance = await getCampaignPerformance(brand, campaigns, today, currentMonth);

    return Response.json({
      ok: true,
      brand,
      products,
      campaigns: {
        activeCount: activeCampaigns.length,
        monthlyCount: monthlyCampaigns.length,
        next: activeCampaigns.sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null,
        performance: campaignPerformance,
      },
      ads,
      content: {
        instagram,
        threads,
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
