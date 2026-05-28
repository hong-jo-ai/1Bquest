/**
 * 수동 동기화 — 대시보드에서 직접 평가 사이클을 돌려 Meta 최신 광고/예산/지출을 즉시 반영.
 * 인증 게이트(`/api/mads/`) 안쪽이라 로그인 사용자만 호출 가능.
 *
 *   GET  → 마지막 동기화 시각(mads_ad_sets.last_synced_at 최댓값)
 *   POST → runEvaluationCycle 실행 후 결과 + 갱신된 마지막 동기화 시각
 */
import { runEvaluationCycle } from "@/lib/mads/orchestrator";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getLastSyncedAt(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db
    .from("mads_ad_sets")
    .select("last_synced_at")
    .order("last_synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.last_synced_at ?? null;
}

export async function GET() {
  return Response.json({ ok: true, lastSyncedAt: await getLastSyncedAt() });
}

export async function POST() {
  const result = await runEvaluationCycle();
  const lastSyncedAt = await getLastSyncedAt();
  return Response.json({ ...result, lastSyncedAt }, { status: result.ok ? 200 : 500 });
}
