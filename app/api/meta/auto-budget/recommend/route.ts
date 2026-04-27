import { metaGet } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import {
  fetchAdsetsWith7dInsights,
  recommendForAdset,
  type BudgetRecommendation,
} from "@/lib/metaAutoBudget";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function kstDateStr(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "Meta 미연결" }, { status: 401 });

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ ok: false, error: "Supabase 미연결" }, { status: 500 });
  }

  const runDate = kstDateStr();

  // 모든 광고 계정 조회
  const accountsRes = (await metaGet("/me/adaccounts", token, {
    fields: "id,name,account_status",
    limit: "20",
  })) as { data?: Array<{ id: string; name: string; account_status: number }> };

  const accounts = (accountsRes.data ?? []).filter((a) => a.account_status === 1);
  if (accounts.length === 0) {
    return Response.json({ ok: true, accounts: 0, recommendations: [] });
  }

  const all: BudgetRecommendation[] = [];
  const errors: Array<{ accountId: string; name: string; error: string }> = [];

  await Promise.all(
    accounts.map(async (acc) => {
      try {
        const snaps = await fetchAdsetsWith7dInsights(token, acc.id, acc.name);
        for (const snap of snaps) {
          all.push(recommendForAdset(snap));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[auto-budget] account ${acc.id} 실패:`, msg);
        errors.push({ accountId: acc.id, name: acc.name, error: msg });
      }
    })
  );

  // Supabase 저장 (날짜+adset 유니크 → 같은 날 재실행 시 덮어쓰기)
  if (all.length > 0) {
    const rows = all.map((r) => ({
      run_date:           runDate,
      account_id:         r.accountId,
      account_name:       r.accountName,
      adset_id:           r.adsetId,
      adset_name:         r.adsetName,
      campaign_name:      r.campaignName,
      spend_7d:           Math.round(r.spend7d),
      roas_7d:            r.roas7d,
      current_budget:     r.currentBudget,
      recommended_budget: r.recommendedBudget,
      delta_pct:          r.deltaPct,
      action:             r.action,
      reason:             r.reason,
    }));

    const { error } = await supabase
      .from("meta_auto_budget_log")
      .upsert(rows, { onConflict: "run_date,adset_id" });

    if (error) {
      return Response.json(
        { ok: false, error: `Supabase upsert 실패: ${error.message}`, recommendations: all.length },
        { status: 500 }
      );
    }
  }

  // 액션별 카운트 (응답 요약용)
  const counts = all.reduce(
    (acc, r) => {
      acc[r.action] = (acc[r.action] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return Response.json({
    ok: true,
    runDate,
    accounts: accounts.length,
    recommendations: all.length,
    counts,
    errors: errors.length > 0 ? errors : undefined,
  });
}
