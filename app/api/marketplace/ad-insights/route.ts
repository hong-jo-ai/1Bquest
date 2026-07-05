/**
 * GET /api/marketplace/ad-insights?since=YYYY-MM-DD&until=YYYY-MM-DD&level=campaign
 *   헤더: x-agent-token: <PAULWISE_MCP_TOKEN>
 *
 * Meta 광고 인사이트를 캠페인(기본)/광고세트/광고 레벨로 분해해서 반환.
 * "왜 전환이 없지?"를 노출·클릭·CTR·장바구니·구매까지 광고별로 진단하기 위한 읽기 전용 엔드포인트.
 * 세션 우회(x-agent-token) — 에이전트가 직접 조회 가능. 토큰/계정은 MADS와 동일 소스.
 */
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { resolveAdAccountId } from "@/lib/metaBrandFilter";
import { metaGet } from "@/lib/metaClient";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PURCHASE = new Set(["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
const ADDCART = new Set(["add_to_cart", "omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]);

interface Action { action_type: string; value: string }
function sumOf(arr: Action[] | undefined, set: Set<string>): number {
  if (!Array.isArray(arr)) return 0;
  return arr.filter((a) => set.has(a.action_type)).reduce((s, a) => s + (Number(a.value) || 0), 0);
}
function oneOf(arr: Action[] | undefined, type: string): number {
  if (!Array.isArray(arr)) return 0;
  return arr.filter((a) => a.action_type === type).reduce((s, a) => s + (Number(a.value) || 0), 0);
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const metaToken = await getMetaTokenServer();
    if (!metaToken) return Response.json({ error: "Meta 토큰 없음" }, { status: 401 });
    const accountId = req.nextUrl.searchParams.get("account") ?? (await resolveAdAccountId(metaToken));

    const level = req.nextUrl.searchParams.get("level") ?? "campaign"; // campaign | adset | ad
    const until = req.nextUrl.searchParams.get("until") ?? new Date().toISOString().slice(0, 10);
    const sinceDefault = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const since = req.nextUrl.searchParams.get("since") ?? sinceDefault;

    const nameField = level === "ad" ? "ad_name" : level === "adset" ? "adset_name" : "campaign_name";
    const res = (await metaGet(`/${accountId}/insights`, metaToken, {
      level,
      fields: `${nameField},spend,impressions,clicks,ctr,cpc,reach,actions,action_values`,
      time_range: JSON.stringify({ since, until }),
      limit: "200",
    })) as { data?: Array<Record<string, unknown>> };

    const rows = (res.data ?? []).map((r) => {
      const actions = r.actions as Action[] | undefined;
      const values = r.action_values as Action[] | undefined;
      const spend = Number(r.spend) || 0;
      const purchases = sumOf(actions, PURCHASE);
      const purchaseValue = sumOf(values, PURCHASE);
      return {
        name: r[nameField] as string,
        spend,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        ctr: Number(r.ctr) || 0,
        linkClicks: oneOf(actions, "link_click"),
        landingViews: oneOf(actions, "landing_page_view"),
        addToCart: sumOf(actions, ADDCART),
        initiateCheckout: oneOf(actions, "initiate_checkout") + oneOf(actions, "omni_initiated_checkout"),
        purchases,
        purchaseValue,
        roas: spend > 0 ? +(purchaseValue / spend).toFixed(2) : 0,
      };
    });
    // 소진 큰 순 정렬
    rows.sort((a, b) => b.spend - a.spend);
    const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
    const totalPurch = rows.reduce((s, r) => s + r.purchases, 0);

    return Response.json({
      ok: true, accountId, level, since, until,
      summary: { campaigns: rows.length, totalSpend: +totalSpend.toFixed(0), totalPurchases: totalPurch },
      rows,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
