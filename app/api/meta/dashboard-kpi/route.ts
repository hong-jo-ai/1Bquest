import { metaGet } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// /api/profit/meta-spend와 동일한 패턴
const BRAND_ACCOUNT_PATTERNS: Record<string, RegExp[]> = {
  paulvice: [/icaruse/i, /폴바이스/, /paulvice/i],
  harriot:  [/해리엇/, /harriot/i],
};

function accountMatchesBrand(name: string, brand: string): boolean {
  const patterns = BRAND_ACCOUNT_PATTERNS[brand];
  if (!patterns) return false;
  return patterns.some((p) => p.test(name));
}

function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface InsightRow {
  spend?:         string;
  purchase_roas?: { value: string }[];
  actions?:       { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
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
    const accountsRes = (await metaGet("/me/adaccounts", token, {
      fields: "id,name,currency",
      limit: "20",
    })) as { data?: Array<{ id: string; name: string }> };

    const allAccounts = accountsRes.data ?? [];
    const accounts = brand
      ? allAccounts.filter((a) => accountMatchesBrand(a.name, brand))
      : allAccounts;

    if (accounts.length === 0) {
      return Response.json({
        ok: true, since, until,
        spend: 0, purchaseValue: 0, purchaseCount: 0, roas: 0,
        accounts: 0,
        warning: brand ? `브랜드 '${brand}' 매칭 광고 계정 없음` : "광고 계정 없음",
      });
    }

    let spend = 0;
    let purchaseValue = 0;
    let purchaseCount = 0;

    await Promise.all(
      accounts.map(async (acc) => {
        try {
          const ins = (await metaGet(`/${acc.id}/insights`, token, {
            fields: "spend,purchase_roas,actions,action_values",
            time_range: JSON.stringify({ since, until }),
            level: "account",
          })) as { data?: InsightRow[] };

          const row = ins.data?.[0];
          if (!row) return;

          spend         += parseFloat(row.spend ?? "0");
          purchaseValue += sumPurchaseAction(row.action_values);
          purchaseCount += sumPurchaseAction(row.actions);
        } catch (e) {
          console.error(`[dashboard-kpi] ${acc.id} 실패:`, e);
        }
      })
    );

    const roas = spend > 0 ? purchaseValue / spend : 0;

    return Response.json({
      ok: true, since, until,
      spend:         Math.round(spend),
      purchaseValue: Math.round(purchaseValue),
      purchaseCount: Math.round(purchaseCount),
      roas,
      accounts: accounts.length,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
