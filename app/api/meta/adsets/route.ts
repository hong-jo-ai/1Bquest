import { metaGet } from "@/lib/metaClient";
import { INSIGHT_FIELDS, PERIOD_META_PRESET, type Period } from "@/lib/metaData";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";

export interface MetaAdSet {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
  campaignId: string;
  campaignName: string;
  dailyBudget: number;
  optimizationGoal: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  reach: number;
  roas: number;
  frequency: number;
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("meta_at")?.value;
  if (!token) return Response.json({ error: "Meta 미연결" }, { status: 401 });

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return Response.json({ error: "accountId 없음" }, { status: 400 });

  const period = (req.nextUrl.searchParams.get("period") ?? "month") as Period;
  const datePreset = PERIOD_META_PRESET[period] ?? "this_month";

  try {
    const data = await metaGet(`/${accountId}/adsets`, token, {
      fields: [
        "id", "name", "status", "campaign_id", "campaign{name}",
        "daily_budget", "optimization_goal",
        `insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
      ].join(","),
      effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
      limit: "50",
    });

    const adsets: MetaAdSet[] = (data.data ?? []).map((s: any) => {
      const ins = s.insights?.data?.[0] ?? {};
      const spend       = parseFloat(ins.spend       ?? "0");
      const impressions = parseInt(ins.impressions   ?? "0", 10);
      const clicks      = parseInt(ins.clicks        ?? "0", 10);
      const ctr         = parseFloat(ins.ctr         ?? "0");
      const cpm         = parseFloat(ins.cpm         ?? "0");
      const reach       = parseInt(ins.reach         ?? "0", 10);
      const frequency   = parseFloat(ins.frequency   ?? "0");
      let roas = 0;
      if (Array.isArray(ins.purchase_roas) && ins.purchase_roas.length > 0) {
        roas = parseFloat(ins.purchase_roas[0].value ?? "0");
      }
      return {
        id: s.id, name: s.name, status: s.status,
        campaignId: s.campaign_id ?? "",
        campaignName: s.campaign?.name ?? "",
        dailyBudget: parseInt(s.daily_budget ?? "0", 10),
        optimizationGoal: s.optimization_goal ?? "",
        spend, impressions, clicks, ctr, cpm, reach, roas, frequency,
      };
    });

    return Response.json({ adsets });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
