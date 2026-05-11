import { metaGet } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { campaignMatchesBrand, resolveAdAccountId } from "@/lib/metaBrandFilter";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface CampaignInsightRow {
  campaign_id?:    string;
  campaign_name?:  string;
  spend?:          string;
  actions?:        { action_type: string; value: string }[];
  action_values?:  { action_type: string; value: string }[];
}

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

function sumPurchaseAction(rows: { action_type: string; value: string }[] | undefined): number {
  if (!rows) return 0;
  let total = 0;
  for (const r of rows) {
    if (PURCHASE_ACTIONS.has(r.action_type)) {
      // 같은 'purchase'가 여러 attribution window에 분산될 수 있어 한 번만 카운트
      total = Math.max(total, parseFloat(r.value ?? "0"));
    }
  }
  return total;
}

export async function GET(req: NextRequest) {
  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "Meta 미연결" });

  // 기간: preset (today/last7d/this_month) 또는 사용자 지정 (since/until)
  const preset = req.nextUrl.searchParams.get("preset") ?? "";
  const brand  = req.nextUrl.searchParams.get("brand") ?? "";
  let since = req.nextUrl.searchParams.get("since") ?? "";
  let until = req.nextUrl.searchParams.get("until") ?? "";

  if (preset === "today") {
    since = kstDateStr(0);
    until = kstDateStr(0);
  } else if (preset === "yesterday") {
    since = kstDateStr(-1);
    until = kstDateStr(-1);
  } else if (preset === "last7d") {
    since = kstDateStr(-6);
    until = kstDateStr(0);
  } else if (preset === "month") {
    const today = kstDateStr(0);
    since = today.slice(0, 8) + "01";
    until = today;
  }

  if (!since || !until) {
    return Response.json({ ok: false, error: "기간(since/until 또는 preset) 필요" }, { status: 400 });
  }

  try {
    const accountId = await resolveAdAccountId(token);

    // 캠페인 단위 인사이트 → 캠페인명 패턴으로 브랜드 분리.
    const ins = (await metaGet(`/${accountId}/insights`, token, {
      fields:     "spend,actions,action_values,campaign_id,campaign_name",
      time_range: JSON.stringify({ since, until }),
      level:      "campaign",
      limit:      "500",
    })) as { data?: CampaignInsightRow[] };

    const rows = (ins.data ?? []).filter((r) => campaignMatchesBrand(r.campaign_name, brand));

    let spend = 0;
    let purchaseValue = 0;
    let purchaseCount = 0;

    for (const row of rows) {
      spend         += parseFloat(row.spend ?? "0");
      purchaseValue += sumPurchaseAction(row.action_values);
      purchaseCount += sumPurchaseAction(row.actions);
    }

    const roas = spend > 0 ? purchaseValue / spend : 0;

    return Response.json({
      ok: true, since, until,
      spend:         Math.round(spend),
      purchaseValue: Math.round(purchaseValue),
      purchaseCount: Math.round(purchaseCount),
      roas,
      accountId,
      campaignsCounted: rows.length,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
