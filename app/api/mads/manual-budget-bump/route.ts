/**
 * 수동 예산 증액 — untrusted/learning 광고세트가 데이터 부족으로 hold 됐을 때
 * 사용자가 직접 일예산을 N%(기본 20) 올려서 학습 가속.
 *
 * 룰 엔진과 충돌 안 하도록:
 *   - mads_ad_sets.last_budget_change_at 갱신 → 다음 평가에서 recent_budget_change 락 발동
 *   - manual_action_logs 에 source='manual' 로 기록 → wobble 검출에 카운트됨
 */
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { updateAdsetBudget } from "@/lib/mads/metaAdsetClient";
import { logManualAction } from "@/lib/mads/wobbleDetector";
import { getMarginConfig } from "@/lib/mads/marginConfig";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 미설정");
  return createClient(url, key);
}

export async function POST(req: Request) {
  let body: { metaAdsetId?: string; deltaPct?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 요청 본문" }, { status: 400 });
  }

  const metaAdsetId = body.metaAdsetId?.trim();
  const deltaPct = Number.isFinite(body.deltaPct) ? Number(body.deltaPct) : 20;

  if (!metaAdsetId) {
    return Response.json({ ok: false, error: "metaAdsetId 필요" }, { status: 400 });
  }
  if (deltaPct <= 0 || deltaPct > 100) {
    return Response.json({ ok: false, error: "deltaPct 는 1~100 사이" }, { status: 400 });
  }

  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "Meta 토큰 없음" }, { status: 400 });

  const db = getDb();
  const { data: row, error } = await db
    .from("mads_ad_sets")
    .select("daily_budget, last_budget_change_at, name")
    .eq("meta_adset_id", metaAdsetId)
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!row) return Response.json({ ok: false, error: "광고세트 없음" }, { status: 404 });

  const cur = Number(row.daily_budget);
  if (!Number.isFinite(cur) || cur <= 0) {
    return Response.json(
      { ok: false, error: "현재 일예산이 없거나 0 (CBO 캠페인일 수 있음 — 캠페인 예산을 직접 조정)" },
      { status: 400 },
    );
  }

  const cfg = await getMarginConfig();
  const minBudget = cfg.policy.minBudgetKrw;
  const raw = cur * (1 + deltaPct / 100);
  const next = Math.max(Math.round(raw / 100) * 100, minBudget);

  if (next === cur) {
    return Response.json({ ok: false, error: "변경 후 금액이 현재와 동일 (반올림 또는 하한)" }, { status: 400 });
  }

  // Meta 업데이트
  try {
    await updateAdsetBudget(token, metaAdsetId, next);
  } catch (e) {
    return Response.json(
      { ok: false, error: `Meta 업데이트 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  // 락 발동을 위해 last_budget_change_at + daily_budget 갱신
  await db
    .from("mads_ad_sets")
    .update({
      daily_budget:          next,
      last_budget_change_at: new Date().toISOString(),
      last_synced_at:        new Date().toISOString(),
    })
    .eq("meta_adset_id", metaAdsetId);

  // 흔들림 검출용 로그
  await logManualAction(metaAdsetId, "budget_bump_manual", "manual", {
    from: cur,
    to: next,
    deltaPct,
    reason: "untrusted_breakthrough",
  });

  return Response.json({
    ok: true,
    metaAdsetId,
    name: row.name,
    from: cur,
    to: next,
    deltaPct,
  });
}
