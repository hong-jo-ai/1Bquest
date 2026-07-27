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

// 같은 세트·같은 액션 카드는 이 기간에 한 번만 발송 (매일 재나그 방지)
const CARD_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3일

/**
 * 실행형 추천(hold 제외)을 텔레그램 확인카드로 발송 — 감사 조치.
 * (추천이 매일 생성→미결정 소멸되던 병목: 이메일 리포트는 안 읽히니 1탭 승인 카드로)
 *
 * 중복 방지: 추천은 매일 새 `id`로 재생성되므로 recId 키로는 절대 안 걸림 → 매일 같은
 * 카드가 재발송되던 버그. 그래서 키를 `mads_card_sent:<세트ID>:<액션>` (콘텐츠 시그니처)로
 * 잡고 3일 쿨다운을 둔다. 추가로, 이미 꺼진(ACTIVE 아님) 세트엔 조치 카드를 보내지 않는다
 * (세트 안 개별 광고만 꺼도 세트는 ACTIVE로 남아 계속 나그되므로 쿨다운이 최종 방어선).
 */
async function notifyActionable(): Promise<number> {
  const pending = await listRecommendations("pending", 50);
  const actionable = pending
    .filter((r) => r.actionType !== "hold")
    // 꺼진 세트엔 조치 불필요 — 카드 발송 안 함. status 미상(null)은 통과.
    .filter((r) => !r.adset?.status || r.adset.status === "ACTIVE")
    .slice(0, 5);
  if (!actionable.length) return 0;

  const sigOf = (r: (typeof actionable)[number]) => `mads_card_sent:${r.metaAdsetId}:${r.actionType}`;

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const keys = [...new Set(actionable.map(sigOf))];
  const { data: sent } = await sb.from("kv_store").select("key, data").in("key", keys);
  const now = Date.now();
  const lastSentAt = new Map<string, number>(
    (sent || []).map((r) => {
      const at = (r.data as { at?: string } | null)?.at;
      return [r.key, at ? new Date(at).getTime() : 0] as const;
    }),
  );

  let count = 0;
  for (const r of actionable) {
    const sig = sigOf(r);
    if (now - (lastSentAt.get(sig) ?? 0) < CARD_COOLDOWN_MS) continue; // 쿨다운 내 동일 카드 억제
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
      { key: sig, data: { at: new Date().toISOString(), recId: r.id }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    lastSentAt.set(sig, now); // 같은 배치 내 중복 방지
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
