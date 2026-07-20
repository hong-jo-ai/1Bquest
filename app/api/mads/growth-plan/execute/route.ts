/**
 * 성장 전략 플랜 실행 — "즉시 실행" + "수정사항 반영 실행".
 *
 * POST { planIndex, modification?, confirm? }
 *   - modification: 대표의 수정 지시(자연어) → Claude가 액션을 수정해 반영.
 *   - confirm 없으면 dryRun(실행될 액션 미리보기), confirm:true면 Meta에 실제 적용.
 *
 * 실행 가능 액션: adset_budget / adset_status / ad_status / campaign_status.
 * 예산 변경은 mads 락(72h)·흔들림 로그에 기록된다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { metaGet, metaPost } from "@/lib/metaClient";
import { logManualAction } from "@/lib/mads/wobbleDetector";
import { GROWTH_PLAN_KV_KEY, type GrowthPlan, type PlanAction } from "@/lib/mads/growthStrategist";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function getDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const VALID_KINDS = new Set(["adset_budget", "adset_status", "ad_status", "campaign_status"]);
const VALID_STATUS = new Set(["ACTIVE", "PAUSED"]);

function validateActions(actions: PlanAction[]): string | null {
  for (const a of actions) {
    if (!VALID_KINDS.has(a.kind)) return `알 수 없는 액션 종류: ${a.kind}`;
    if (!a.targetId || !/^\d{6,}$/.test(String(a.targetId))) return `잘못된 대상 ID: ${a.targetId}`;
    if (a.kind === "adset_budget") {
      const v = Number(a.value);
      if (!Number.isFinite(v) || v < 3000 || v > 500000) return `예산 범위 밖(3천~50만): ${a.value}`;
    } else if (!VALID_STATUS.has(String(a.value))) return `잘못된 상태값: ${a.value}`;
  }
  return null;
}

/** 대표 수정 지시를 액션에 반영 — 소규모 LLM 호출. */
async function reviseActions(
  plan: { title: string; why: string; actions: PlanAction[] },
  modification: string,
): Promise<{ actions: PlanAction[]; note: string }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: `광고 실행 플랜의 API 액션 목록을 대표의 수정 지시에 맞게 고쳐라.

플랜: ${plan.title}
근거: ${plan.why.slice(0, 300)}
현재 액션(JSON): ${JSON.stringify(plan.actions)}

대표 수정 지시: "${modification}"

규칙: kind는 adset_budget|adset_status|ad_status|campaign_status만. targetId는 기존 액션에 있는 실제 id만 사용(새 id 창작 금지). 예산 value는 원 단위 숫자, 상태 value는 ACTIVE|PAUSED만. 지시가 액션으로 반영 불가능하면(예: 소재 수정 요청) actions는 그대로 두고 note에 설명.

JSON만: {"actions":[...], "note":"수정 내용 한 줄 요약"}`,
    }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const start = text.indexOf("{");
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (start < 0 || end < 0) throw new Error("수정안 파싱 실패");
  return JSON.parse(text.slice(start, end + 1));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      planIndex?: number; modification?: string; confirm?: boolean;
    };
    const idx = Number(body.planIndex);
    if (!Number.isFinite(idx)) return Response.json({ ok: false, error: "planIndex 필요" }, { status: 400 });

    const db = getDb();
    const { data: kv } = await db.from("kv_store").select("data").eq("key", GROWTH_PLAN_KV_KEY).maybeSingle();
    const plan = kv?.data as GrowthPlan | undefined;
    const item = plan?.plans?.[idx];
    if (!plan || !item) return Response.json({ ok: false, error: "플랜 없음 — 전략을 먼저 생성하세요" }, { status: 404 });
    if (item.executedAt) return Response.json({ ok: false, error: `이미 ${item.executedAt.slice(0, 16)}에 실행됨 — 전략 재생성 후 다시` }, { status: 409 });

    let actions = item.actions ?? [];
    let revisionNote: string | null = null;
    if (body.modification?.trim()) {
      const revised = await reviseActions(item, body.modification.trim());
      actions = revised.actions;
      revisionNote = revised.note;
    }
    if (actions.length === 0) {
      return Response.json({
        ok: false,
        error: "이 플랜엔 API 즉시실행 액션이 없습니다(소재 제작 등 수동 스텝만). 실행 스텝을 클로드에게 지시해주세요.",
        revisionNote,
      }, { status: 422 });
    }
    const invalid = validateActions(actions);
    if (invalid) return Response.json({ ok: false, error: `액션 검증 실패: ${invalid}` }, { status: 422 });

    if (!body.confirm) {
      return Response.json({ ok: true, dryRun: true, planTitle: item.title, actions, revisionNote });
    }

    const token = await getMetaTokenServer();
    if (!token) return Response.json({ ok: false, error: "Meta 토큰 없음" }, { status: 401 });

    const results: Array<{ action: PlanAction; ok: boolean; error?: string }> = [];
    for (const a of actions) {
      try {
        if (a.kind === "adset_budget") {
          const next = Math.round(Number(a.value));
          const before = (await metaGet(`/${a.targetId}`, token, { fields: "daily_budget,name" })) as { daily_budget?: string; name?: string };
          await metaPost(`/${a.targetId}`, token, { daily_budget: String(next) });
          await db.from("mads_ad_sets").update({
            daily_budget: next, last_budget_change_at: new Date().toISOString(), last_synced_at: new Date().toISOString(),
          }).eq("meta_adset_id", a.targetId);
          await logManualAction(a.targetId, "budget_change_growth_plan", "manual", {
            from: Number(before.daily_budget ?? 0), to: next, plan: item.title,
          });
        } else {
          await metaPost(`/${a.targetId}`, token, { status: String(a.value) });
        }
        results.push({ action: a, ok: true });
      } catch (e) {
        results.push({ action: a, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // 플랜에 실행 기록 저장
    item.executedAt = new Date().toISOString();
    item.executionResults = results;
    item.actions = actions;
    await db.from("kv_store").upsert(
      { key: GROWTH_PLAN_KV_KEY, data: plan as unknown as object, updated_at: new Date().toISOString() },
      { onConflict: "key" });

    const failed = results.filter((r) => !r.ok).length;
    return Response.json({ ok: failed === 0, planTitle: item.title, results, revisionNote, failed });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
