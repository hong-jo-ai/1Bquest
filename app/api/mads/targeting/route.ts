/**
 * 광고세트 타겟팅(연령·성별) 조회 — 읽기 전용. 2026-08-25 신설.
 *
 * 왜 필요한가: mads_ad_sets 에는 예산·상태만 쌓이고 타겟팅은 없다. 그래서
 * "우리 타겟이 실수요층과 맞는가"를 대시보드에서 확인할 방법이 없었다.
 * 네이버 데이터랩·검색광고로 확인한 여성시계 실수요는 40~50대인데,
 * 메타 광고가 몇 살을 잡고 있는지 아무도 몰랐다.
 *
 * GET /api/mads/targeting                 → 광고세트별 설정된 타겟팅
 * GET /api/mads/targeting?breakdown=age    → 실제 성과의 연령×성별 분해(최근 90일)
 *   설정값과 실성과를 나란히 봐야 "타겟이 맞는가"를 판단할 수 있다.
 * (헤더 x-agent-token = PAULWISE_MCP_TOKEN)
 */
import { type NextRequest } from "next/server";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { campaignMatchesBrand } from "@/lib/metaBrandFilter";

export const dynamic = "force-dynamic";

const V = "v22.0";
const ACCT = (process.env.META_AD_ACCOUNT_ID || "act_3644222039208759").replace(/^(act_)?/, "act_");

/** Meta genders: [1]=남성 [2]=여성, 빈 배열/없음 = 전체. */
function genderLabel(g?: number[] | null): string {
  if (!g || !g.length) return "전체";
  return g.map((x) => (x === 1 ? "남성" : x === 2 ? "여성" : String(x))).join(",");
}

interface InsightRow {
  age?: string;
  gender?: string;
  spend?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
}

interface AdSetRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  targeting?: { age_min?: number; age_max?: number; genders?: number[] };
  campaign?: { name?: string; effective_status?: string };
}

export async function GET(req: NextRequest) {
  if (req.headers.get("x-agent-token") !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "메타 토큰 없음" }, { status: 500 });

  if (req.nextUrl.searchParams.get("breakdown") === "age") {
    // ⚠️ 한 광고계정에 폴바이스·해리엇이 함께 있다. level=account 로 뽑으면 두 브랜드가 섞여
    //    "폴바이스는 여성만 타겟인데 남성 실적이 왜 있나" 같은 오독이 생긴다(2026-08-28 지적).
    //    brand 파라미터가 오면 캠페인 단위로 뽑아 이름으로 브랜드를 갈라 합산한다.
    const brand = req.nextUrl.searchParams.get("brand") ?? "";
    const p = new URLSearchParams({
      access_token: token,
      fields: brand ? "campaign_name,spend,impressions,clicks,actions,action_values"
                    : "spend,impressions,clicks,actions,action_values",
      breakdowns: "age,gender",
      date_preset: req.nextUrl.searchParams.get("preset") ?? "last_90d",
      level: brand ? "campaign" : "account",
      limit: "500",
    });
    const r = await fetch(`https://graph.facebook.com/${V}/${ACCT}/insights?${p}`, { cache: "no-store" });
    const b = (await r.json()) as { data?: (InsightRow & { campaign_name?: string })[]; error?: unknown };
    if (!r.ok) return Response.json({ ok: false, error: b.error }, { status: 502 });

    const agg = new Map<string, { age: string; gender: string; spend: number; clicks: number; purchases: number; revenue: number }>();
    for (const d of b.data ?? []) {
      if (brand && !campaignMatchesBrand(d.campaign_name, brand)) continue;
      const pur = (d.actions ?? []).find((a) => a.action_type === "purchase");
      const val = (d.action_values ?? []).find((a) => a.action_type === "purchase");
      const age = d.age ?? "?", gender = d.gender ?? "?";
      const k = `${age}|${gender}`;
      const cur = agg.get(k) ?? { age, gender, spend: 0, clicks: 0, purchases: 0, revenue: 0 };
      cur.spend += Number(d.spend ?? 0);
      cur.clicks += Number(d.clicks ?? 0);
      cur.purchases += Number(pur?.value ?? 0);
      cur.revenue += Number(val?.value ?? 0);
      agg.set(k, cur);
    }
    const rows = [...agg.values()]
      .map((r2) => ({ ...r2, spend: Math.round(r2.spend), revenue: Math.round(r2.revenue) }))
      .sort((x, y) => y.revenue - x.revenue);
    return Response.json({ ok: true, breakdown: "age", brand: brand || "all", rows });
  }

  const qs = new URLSearchParams({
    access_token: token,
    fields: "id,name,status,effective_status,daily_budget,targeting{age_min,age_max,genders},campaign{name,effective_status}",
    limit: "200",
  });
  const res = await fetch(`https://graph.facebook.com/${V}/${ACCT}/adsets?${qs}`, { cache: "no-store" });
  const body = (await res.json()) as { data?: AdSetRow[]; error?: unknown };
  if (!res.ok) return Response.json({ ok: false, error: body.error }, { status: 502 });

  const adsets = (body.data ?? []).map((s) => ({
    id: s.id,
    name: s.name ?? "",
    campaign: s.campaign?.name ?? null,
    status: s.effective_status ?? s.status ?? null,
    ageMin: s.targeting?.age_min ?? null,
    ageMax: s.targeting?.age_max ?? null,
    genders: genderLabel(s.targeting?.genders),
    dailyBudget: s.daily_budget ? parseInt(s.daily_budget, 10) : null,
  }));
  return Response.json({ ok: true, count: adsets.length, adsets });
}
