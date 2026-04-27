import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export interface AutoBudgetLogRow {
  run_date:           string;
  account_id:         string;
  account_name:       string | null;
  adset_id:           string;
  adset_name:         string | null;
  campaign_name:      string | null;
  spend_7d:           number;
  roas_7d:            number;
  current_budget:     number;     // KRW (원)
  recommended_budget: number;     // KRW
  delta_pct:          number;
  action:             "increase" | "decrease" | "maintain" | "pause" | "skipped";
  reason:             string | null;
  applied:            boolean;
  applied_at:         string | null;
}

export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return Response.json({ ok: false, error: "Supabase 미연결" }, { status: 500 });

  const days = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("days") ?? "14", 10), 1),
    60
  );
  const since = new Date(Date.now() + 9 * 60 * 60 * 1000 - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("meta_auto_budget_log")
    .select(
      "run_date,account_id,account_name,adset_id,adset_name,campaign_name,spend_7d,roas_7d,current_budget,recommended_budget,delta_pct,action,reason,applied,applied_at"
    )
    .gte("run_date", since)
    .order("run_date", { ascending: false })
    .order("action", { ascending: true })
    .order("spend_7d", { ascending: false });

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, since, rows: (data ?? []) as AutoBudgetLogRow[] });
}
