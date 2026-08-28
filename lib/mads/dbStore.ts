/**
 * Supabase persistence helpers for MADS tables.
 */
import { createClient } from "@supabase/supabase-js";
import type {
  AdDailyMetric,
  AdSetSummary,
  AdSummary,
  DailyMetric,
  Recommendation,
  RecStatus,
  TrustEvaluation,
} from "./types";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 미설정");
  return createClient(url, key);
}

function newerIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

// ── ad_sets ───────────────────────────────────────────────────────────
export interface AdSetUpsertResult {
  metaAdsetId: string;
  lastBudgetChangeAt: string | null;
}

export async function upsertAdSets(rows: AdSetSummary[]): Promise<AdSetUpsertResult[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const ids = rows.map((r) => r.metaAdsetId);
  const { data: existing, error: existingError } = await db
    .from("mads_ad_sets")
    .select("meta_adset_id, daily_budget, last_budget_change_at")
    .in("meta_adset_id", ids);
  if (existingError) throw new Error("ad_sets existing select: " + existingError.message);

  const existingById = new Map(
    (existing ?? []).map((r) => [
      r.meta_adset_id as string,
      {
        dailyBudget: r.daily_budget !== null ? Number(r.daily_budget) : null,
        lastBudgetChangeAt: r.last_budget_change_at as string | null,
      },
    ]),
  );
  const now = new Date().toISOString();
  const changeRows: Array<{
    meta_adset_id: string;
    action: string;
    source: string;
    detail: Record<string, unknown>;
  }> = [];
  const upsertResults: AdSetUpsertResult[] = [];

  const { error } = await db.from("mads_ad_sets").upsert(
    rows.map((r) => {
      const prev = existingById.get(r.metaAdsetId);
      const prevBudget = prev?.dailyBudget ?? null;
      const nextBudget = r.dailyBudget;
      const budgetChanged =
        prevBudget !== null &&
        nextBudget !== null &&
        prevBudget !== nextBudget;
      const lastBudgetChangeAt = budgetChanged
        ? now
        : newerIso(prev?.lastBudgetChangeAt, r.lastBudgetChangeAt);

      if (budgetChanged) {
        const deltaPct = prevBudget > 0
          ? Math.round(((nextBudget - prevBudget) / prevBudget) * 100)
          : null;
        changeRows.push({
          meta_adset_id: r.metaAdsetId,
          action: "budget_change_detected",
          source: "meta_ui",
          detail: {
            from: prevBudget,
            to: nextBudget,
            deltaPct,
          },
        });
      }
      upsertResults.push({ metaAdsetId: r.metaAdsetId, lastBudgetChangeAt });

      return {
        meta_adset_id:         r.metaAdsetId,
        meta_account_id:       r.metaAccountId,
        account_name:          r.accountName,
        campaign_id:           r.campaignId,
        campaign_name:         r.campaignName,
        campaign_objective:    r.campaignObjective,
        name:                  r.name,
        status:                r.status,
        daily_budget:          r.dailyBudget,
        funnel_stage:          r.funnelStage,
        last_budget_change_at: lastBudgetChangeAt,
        last_synced_at:        now,
        // 미수집(undefined) 시 기존 값 유지 — null로 덮어쓰지 않음
        ...(r.creativeFormats !== undefined ? { creative_formats: r.creativeFormats } : {}),
      };
    }),
    { onConflict: "meta_adset_id" },
  );
  if (error) throw new Error("ad_sets upsert: " + error.message);

  if (changeRows.length > 0) {
    const { error: logError } = await db.from("mads_manual_action_logs").insert(changeRows);
    if (logError) console.warn("[mads] manual_action_logs insert:", logError.message);
  }

  return upsertResults;
}

/**
 * Meta에서 더 이상 ACTIVE로 안 잡히는 세트를 PAUSED로 정리.
 * activeIds = 이번 사이클에서 Meta가 effective ACTIVE로 돌려준 세트 전체.
 * ⚠️ 호출 측에서 모든 계정 fetch 성공을 보장한 경우에만 호출할 것 (부분 실패 시 대량 오삭제 위험).
 * @returns PAUSED 처리된 세트 수
 */
export async function deactivateStaleAdSets(activeIds: string[]): Promise<number> {
  const db = getDb();
  let q = db
    .from("mads_ad_sets")
    .update({ status: "PAUSED", last_synced_at: new Date().toISOString() })
    .eq("status", "ACTIVE");
  if (activeIds.length > 0) {
    q = q.not("meta_adset_id", "in", `(${activeIds.join(",")})`);
  }
  const { data, error } = await q.select("meta_adset_id");
  if (error) throw new Error("ad_sets deactivate: " + error.message);
  return data?.length ?? 0;
}

export async function getAdSet(metaAdsetId: string): Promise<AdSetSummary | null> {
  const db = getDb();
  const { data } = await db
    .from("mads_ad_sets")
    .select("*")
    .eq("meta_adset_id", metaAdsetId)
    .maybeSingle();
  if (!data) return null;
  return mapAdSet(data);
}

export async function listAdSets(): Promise<AdSetSummary[]> {
  const db = getDb();
  const { data } = await db
    .from("mads_ad_sets")
    .select("*")
    .order("name");
  return (data ?? []).map(mapAdSet);
}

interface DbAdSet {
  meta_adset_id: string;
  meta_account_id: string;
  account_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_objective: string | null;
  name: string;
  status: string;
  daily_budget: number | null;
  funnel_stage: string;
  last_budget_change_at: string | null;
  creative_formats: string[] | null;
}

function mapAdSet(d: DbAdSet): AdSetSummary {
  return {
    metaAdsetId:        d.meta_adset_id,
    metaAccountId:      d.meta_account_id,
    accountName:        d.account_name,
    campaignId:         d.campaign_id,
    campaignName:       d.campaign_name,
    campaignObjective:  d.campaign_objective,
    name:               d.name,
    status:             d.status,
    dailyBudget:        d.daily_budget,
    funnelStage:        (d.funnel_stage ?? "unknown") as AdSetSummary["funnelStage"],
    lastBudgetChangeAt: d.last_budget_change_at,
    creativeFormats:    d.creative_formats ?? null,
  };
}

// ── daily_metrics ──────────────────────────────────────────────────────
export async function upsertDailyMetrics(
  metaAdsetId: string,
  metrics: DailyMetric[],
): Promise<void> {
  if (metrics.length === 0) return;
  const db = getDb();
  const { error } = await db.from("mads_daily_metrics").upsert(
    metrics.map((m) => ({
      meta_adset_id:       metaAdsetId,
      date:                m.date,
      spend:               m.spend,
      revenue:             m.revenue,
      conversions:         m.conversions,
      impressions:         m.impressions,
      clicks:              m.clicks,
      ctr:                 m.ctr,
      largest_order_value: m.largestOrderValue,
      is_provisional:      m.isProvisional,
      cpm:                 m.cpm ?? null,
      frequency:           m.frequency ?? null,
      reach:               m.reach ?? null,
      fetched_at:          new Date().toISOString(),
    })),
    { onConflict: "meta_adset_id,date" },
  );
  if (error) throw new Error("daily_metrics upsert: " + error.message);
}

// ── ads (개별 광고 소재) ───────────────────────────────────────────────
export async function upsertAds(rows: AdSummary[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  const { error } = await db.from("mads_ads").upsert(
    rows.map((a) => ({
      meta_ad_id:       a.metaAdId,
      meta_adset_id:    a.metaAdsetId,
      meta_account_id:  a.metaAccountId,
      name:             a.name,
      effective_status: a.effectiveStatus,
      creative_format:  a.creativeFormat,
      thumbnail_url:    a.thumbnailUrl,
      last_synced_at:   new Date().toISOString(),
    })),
    { onConflict: "meta_ad_id" },
  );
  if (error) throw new Error("mads_ads upsert: " + error.message);
}

export async function upsertAdDailyMetrics(rows: AdDailyMetric[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  const { error } = await db.from("mads_ad_daily_metrics").upsert(
    rows.map((m) => ({
      meta_ad_id:  m.metaAdId,
      date:        m.date,
      spend:       m.spend,
      revenue:     m.revenue,
      conversions: m.conversions,
      impressions: m.impressions,
      clicks:      m.clicks,
      ctr:         m.ctr,
      cpm:         m.cpm,
      frequency:   m.frequency,
      reach:       m.reach,
      fetched_at:  new Date().toISOString(),
    })),
    { onConflict: "meta_ad_id,date" },
  );
  if (error) throw new Error("mads_ad_daily_metrics upsert: " + error.message);
}

// ── trust_evaluations ─────────────────────────────────────────────────
export async function insertTrustEval(
  metaAdsetId: string,
  trust: TrustEvaluation,
): Promise<string> {
  const db = getDb();
  const { data, error } = await db
    .from("mads_trust_evaluations")
    .insert({
      meta_adset_id:        metaAdsetId,
      trust_level:          trust.level,
      conversions_7d:       trust.conversions7d,
      spend_7d:             trust.spend7d,
      revenue_7d:           trust.revenue7d,
      roas_7d:              trust.roas7d,
      roas_3d:              trust.roas3d,
      adjusted_roas_7d:     trust.adjustedRoas7d,
      largest_order_share:  trust.largestOrderShare,
      prev_roas_7d:         trust.prevRoas7d,
      reason:               trust.reason,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("trust_eval insert: " + (error?.message ?? "no id"));
  return data.id;
}

// ── recommendations ───────────────────────────────────────────────────
export interface RecRow {
  id: string;
  metaAdsetId: string;
  trustEvaluationId: string | null;
  createdAt: string;
  expiresAt: string | null;
  actionType: Recommendation["actionType"];
  currentBudget: number | null;
  recommendedBudget: number | null;
  deltaPct: number | null;
  reason: string;
  warnings: Recommendation["warnings"];
  status: RecStatus;
  actedAt: string | null;
  actedResult: unknown;
  // join 편의
  adset?: AdSetSummary | null;
  trust?: {
    level: TrustEvaluation["level"];
    conversions7d: number;
    spend7d: number;
    roas7d: number;
    adjustedRoas7d: number;
  } | null;
}

export async function insertRecommendation(
  metaAdsetId: string,
  trustEvalId: string,
  rec: Recommendation,
  expiresInHours = 36,
): Promise<string> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  // 같은 광고세트의 이전 pending 추천은 superseded 처리
  await db
    .from("mads_recommendations")
    .update({ status: "superseded" })
    .eq("meta_adset_id", metaAdsetId)
    .eq("status", "pending");

  const { data, error } = await db
    .from("mads_recommendations")
    .insert({
      meta_adset_id:       metaAdsetId,
      trust_evaluation_id: trustEvalId,
      action_type:         rec.actionType,
      current_budget:      rec.currentBudget,
      recommended_budget:  rec.recommendedBudget,
      delta_pct:           rec.deltaPct,
      reason:              rec.reason,
      warnings:            rec.warnings,
      status:              "pending",
      expires_at:          expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("recommendation insert: " + (error?.message ?? "no id"));
  return data.id;
}

export async function listRecommendations(
  status?: RecStatus | RecStatus[],
  limit = 200,
): Promise<RecRow[]> {
  const db = getDb();
  let q = db
    .from("mads_recommendations")
    .select(`
      id, meta_adset_id, trust_evaluation_id, created_at, expires_at,
      action_type, current_budget, recommended_budget, delta_pct,
      reason, warnings, status, acted_at, acted_result,
      mads_ad_sets!inner(meta_adset_id, meta_account_id, account_name, campaign_id, campaign_name, campaign_objective, name, status, daily_budget, funnel_stage, last_budget_change_at),
      mads_trust_evaluations(trust_level, conversions_7d, spend_7d, roas_7d, adjusted_roas_7d)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    q = Array.isArray(status) ? q.in("status", status) : q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) throw new Error("recommendations select: " + error.message);

  return (data ?? []).map((r) => {
    const adsetRow = (r as unknown as { mads_ad_sets: DbAdSet | null }).mads_ad_sets;
    const trustRow = (r as unknown as { mads_trust_evaluations: { trust_level: string; conversions_7d: number; spend_7d: number; roas_7d: number; adjusted_roas_7d: number } | null }).mads_trust_evaluations;
    return {
      id:                r.id,
      metaAdsetId:       r.meta_adset_id,
      trustEvaluationId: r.trust_evaluation_id,
      createdAt:         r.created_at,
      expiresAt:         r.expires_at,
      actionType:        r.action_type,
      currentBudget:     r.current_budget,
      recommendedBudget: r.recommended_budget,
      deltaPct:          r.delta_pct !== null ? Number(r.delta_pct) : null,
      reason:            r.reason,
      warnings:          r.warnings ?? [],
      status:            r.status,
      actedAt:           r.acted_at,
      actedResult:       r.acted_result,
      adset:             adsetRow ? mapAdSet(adsetRow) : null,
      trust:             trustRow ? {
        level:           trustRow.trust_level as TrustEvaluation["level"],
        conversions7d:   trustRow.conversions_7d,
        spend7d:         Number(trustRow.spend_7d),
        roas7d:          Number(trustRow.roas_7d),
        adjustedRoas7d:  Number(trustRow.adjusted_roas_7d),
      } : null,
    };
  });
}

/**
 * 광고세트 상태만 갱신 — 사장님이 메타에서 직접 끈 것을 확인했을 때 쓴다(reconcile.ts).
 * 전체 upsert 를 돌리지 않고 상태만 맞춰, 다음 사이클까지 같은 판정을 반복하지 않게 한다.
 */
export async function updateAdSetStatus(metaAdsetId: string, status: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("mads_ad_sets")
    .update({ status, last_synced_at: new Date().toISOString() })
    .eq("meta_adset_id", metaAdsetId);
  if (error) throw new Error("adset status update: " + error.message);
}

export async function setRecommendationStatus(
  id: string,
  status: RecStatus,
  actedResult?: unknown,
): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("mads_recommendations")
    .update({
      status,
      acted_at:    new Date().toISOString(),
      acted_result: actedResult ?? null,
    })
    .eq("id", id);
  if (error) throw new Error("recommendation update: " + error.message);
}

export async function expireOldPending(): Promise<number> {
  const db = getDb();
  const { data, error } = await db
    .from("mads_recommendations")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (error) throw new Error("expire pending: " + error.message);
  return data?.length ?? 0;
}

// ── decision logs ─────────────────────────────────────────────────────
export async function insertDecisionLog(
  recommendationId: string,
  decision: string,
  manualActionCount24h: number,
  note?: string,
): Promise<void> {
  const db = getDb();
  await db.from("mads_decision_logs").insert({
    recommendation_id:        recommendationId,
    decision,
    manual_action_count_24h:  manualActionCount24h,
    note:                     note ?? null,
  });
}

// ── recent metrics ────────────────────────────────────────────────────
export async function getRecentMetrics(
  metaAdsetId: string,
  days = 14,
): Promise<DailyMetric[]> {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data } = await db
    .from("mads_daily_metrics")
    .select("date, spend, revenue, conversions, impressions, clicks, ctr, largest_order_value, is_provisional")
    .eq("meta_adset_id", metaAdsetId)
    .gte("date", since)
    .order("date");
  return (data ?? []).map((m) => ({
    date:               m.date,
    spend:              Number(m.spend),
    revenue:            Number(m.revenue),
    conversions:        Number(m.conversions),
    impressions:        Number(m.impressions),
    clicks:             Number(m.clicks),
    ctr:                m.ctr !== null ? Number(m.ctr) : 0,
    largestOrderValue:  Number(m.largest_order_value),
    isProvisional:      m.is_provisional,
  }));
}
