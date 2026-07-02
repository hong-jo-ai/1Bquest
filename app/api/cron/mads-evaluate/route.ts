import { runEvaluationCycle } from "@/lib/mads/orchestrator";
import { listRecommendations } from "@/lib/mads/dbStore";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { withCron } from "@/lib/cron/withCron";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ACTION_LABEL: Record<string, string> = {
  increase: "📈 예산 증액", decrease: "📉 예산 감액", pause: "⏸ 중단",
  duplicate: "🔀 복제 확장", creative_refresh: "🎨 소재 교체",
};

/**
 * 실행형 추천(hold 제외)을 텔레그램 확인카드로 발송 — 감사 조치.
 * (추천이 매일 생성→미결정 소멸되던 병목: 이메일 리포트는 안 읽히니 1탭 승인 카드로)
 * 중복 방지: kv `mads_card_sent:<recId>` (추천은 매일 새 id로 재생성되므로 자연 소멸)
 */
async function notifyActionable(): Promise<number> {
  const pending = await listRecommendations("pending", 50);
  const actionable = pending.filter((r) => r.actionType !== "hold").slice(0, 5);
  if (!actionable.length) return 0;

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const keys = actionable.map((r) => `mads_card_sent:${r.id}`);
  const { data: sent } = await sb.from("kv_store").select("key").in("key", keys);
  const sentSet = new Set((sent || []).map((r) => r.key));

  let count = 0;
  for (const r of actionable) {
    if (sentSet.has(`mads_card_sent:${r.id}`)) continue;
    const budget = r.currentBudget && r.recommendedBudget
      ? `\n예산: ${Math.round(r.currentBudget).toLocaleString()} → <b>${Math.round(r.recommendedBudget).toLocaleString()}원</b>${r.deltaPct ? ` (${r.deltaPct > 0 ? "+" : ""}${Math.round(r.deltaPct)}%)` : ""}`
      : "";
    const trust = r.trust ? `\nROAS 7d ${r.trust.roas7d?.toFixed(2) ?? "?"} · 전환 ${r.trust.conversions7d ?? "?"}건 · 등급 ${r.trust.level}` : "";
    await sendTelegramMessage(
      [
        `${ACTION_LABEL[r.actionType] ?? r.actionType} <b>추천</b>`,
        `세트: ${r.adset?.name ?? r.metaAdsetId}${budget}${trust}`,
        `근거: ${(r.reason || "").slice(0, 200)}`,
      ].join("\n"),
      {
        buttons: [
          { text: "✅ 승인·적용", callback_data: `mads:accept:${r.id}` },
          { text: "❌ 거절", callback_data: `mads:reject:${r.id}` },
        ],
      },
    );
    await sb.from("kv_store").upsert(
      { key: `mads_card_sent:${r.id}`, data: { at: new Date().toISOString() }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    count++;
  }
  return count;
}

async function cronMain() {
  const result = await runEvaluationCycle();
  let cards = 0;
  try { cards = await notifyActionable(); } catch (e) { console.error("[mads-evaluate] 카드 발송 실패:", e); }
  return Response.json({ ...result, telegramCards: cards }, { status: result.ok ? 200 : 500 });
}

export const GET = withCron("mads-evaluate", () => cronMain());

// 대시보드 "재평가" 버튼용 수동 트리거 (기존 GET 공개호출 → POST 이전)
export async function POST() {
  return cronMain();
}
