import { metaGet } from "@/lib/metaClient";
import { INSIGHT_FIELDS, PERIOD_META_PRESET, type Period } from "@/lib/metaData";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { type NextRequest } from "next/server";

export interface MetaAd {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | "DELETED";
  campaignId: string;
  campaignName: string;
  adsetId: string;
  adsetName: string;
  thumbnailUrl: string;
  title: string;
  body: string;
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
  const token = await getMetaTokenServer();
  if (!token) return Response.json({ error: "Meta 미연결" }, { status: 401 });

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId) return Response.json({ error: "accountId 없음" }, { status: 400 });

  const period = (req.nextUrl.searchParams.get("period") ?? "month") as Period;
  const datePreset = PERIOD_META_PRESET[period] ?? "this_month";

  try {
    const data = await metaGet(`/${accountId}/ads`, token, {
      fields: [
        "id", "name", "status",
        "campaign_id", "campaign{name}",
        "adset_id", "adset{name}",
        "creative{id,title,body,thumbnail_url,image_url}",
        `insights.date_preset(${datePreset}){${INSIGHT_FIELDS}}`,
      ].join(","),
      effective_status: JSON.stringify(["ACTIVE", "PAUSED"]),
      limit: "50",
    });

    const ads: MetaAd[] = (data.data ?? []).map((a: any) => {
      const ins = a.insights?.data?.[0] ?? {};
      const cr = a.creative ?? {};
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
        id: a.id, name: a.name, status: a.status,
        campaignId: a.campaign_id ?? "", campaignName: a.campaign?.name ?? "",
        adsetId: a.adset_id ?? "", adsetName: a.adset?.name ?? "",
        thumbnailUrl: cr.thumbnail_url ?? cr.image_url ?? "",
        title: cr.title ?? "", body: cr.body ?? "",
        spend, impressions, clicks, ctr, cpm, reach, roas, frequency,
      };
    });

    // ROAS 내림차순 정렬
    ads.sort((a, b) => b.roas - a.roas || b.spend - a.spend);

    return Response.json({ ads });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
