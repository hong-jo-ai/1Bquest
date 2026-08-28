/**
 * MADS 아침 텔레그램 브리핑 — 페이지에 안 들어가도 광고 상태가 아침마다 손에 오게.
 *
 * 내용: 어제 계정별 지출/매출/ROAS + 이상신호(BE 미달·급락·소재피로·거부) + 대기 추천 요약.
 * 매일 KST 09:35 (mads-evaluate 09:00 수집 후) cron 발송.
 */
import { getCsSupabase } from "@/lib/cs/store";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { getMarginConfig, resolveThresholds } from "./marginConfig";
import { getActiveSeasonModifier } from "./seasonModifier";
import { listRecommendations } from "./dbStore";
import { ACTION_LABEL_KO } from "./ruleEngine";
import type { ActionType } from "./types";

function kstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
const won = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만원` : Math.round(n).toLocaleString("ko-KR") + "원";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendMadsTelegramBrief(): Promise<{ sent: boolean; reason?: string }> {
  const db = getCsSupabase();
  const yesterday = kstDate(-1);
  const weekAgo = kstDate(-8);

  const [adsetsQ, metricsQ, adsQ, marginCfg, seasonMod, pending] = await Promise.all([
    db.from("mads_ad_sets").select("meta_adset_id,meta_account_id,account_name,name,status"),
    db.from("mads_daily_metrics").select("meta_adset_id,date,spend,revenue,conversions,frequency").gte("date", weekAgo),
    db.from("mads_ads").select("meta_ad_id,name,effective_status"),
    getMarginConfig(),
    getActiveSeasonModifier(),
    listRecommendations("pending", 100),
  ]);
  if (adsetsQ.error || metricsQ.error) {
    return { sent: false, reason: adsetsQ.error?.message ?? metricsQ.error?.message };
  }
  const thresholds = resolveThresholds(marginCfg, seasonMod);
  const be = thresholds.beRoas;

  // 운영 계정만 (META_AD_ACCOUNT_ID) — 휴면 계정 노이즈 제거
  const onlyAccount = (process.env.META_AD_ACCOUNT_ID ?? "").replace(/^act_/, "");
  const adsetRows = (adsetsQ.data ?? []).filter(
    (a) => !onlyAccount || String(a.meta_account_id).replace(/^act_/, "") === onlyAccount);
  const adsetById = new Map(adsetRows.map((a) => [a.meta_adset_id, a]));

  // 계정별 어제 합계 + 지난 7일(어제 제외 6일) 일평균
  interface AccAgg { name: string; ySpend: number; yRevenue: number; yConv: number; prevSpendAvg: number }
  const accs = new Map<string, AccAgg>();
  for (const m of metricsQ.data ?? []) {
    const adset = adsetById.get(m.meta_adset_id);
    if (!adset) continue;
    const acc = accs.get(adset.meta_account_id) ?? {
      name: adset.account_name ?? adset.meta_account_id, ySpend: 0, yRevenue: 0, yConv: 0, prevSpendAvg: 0,
    };
    if (m.date === yesterday) {
      acc.ySpend += Number(m.spend); acc.yRevenue += Number(m.revenue); acc.yConv += m.conversions;
    } else {
      acc.prevSpendAvg += Number(m.spend) / 6;
    }
    accs.set(adset.meta_account_id, acc);
  }

  // 이상신호
  const alerts: string[] = [];
  // 1) 계정 ROAS BE 미달 (어제 지출 있는데)
  for (const acc of accs.values()) {
    if (acc.ySpend >= 5000) {
      const roas = acc.yRevenue / acc.ySpend;
      if (roas < be * 0.7) alerts.push(`🔴 ${esc(acc.name)}: 어제 ROAS ${roas.toFixed(2)} (BE ${be.toFixed(2)} 크게 미달)`);
      // 2) 지출 급변 (평소 대비 ±50%)
      if (acc.prevSpendAvg >= 5000) {
        const delta = (acc.ySpend - acc.prevSpendAvg) / acc.prevSpendAvg;
        if (Math.abs(delta) >= 0.5) {
          alerts.push(`⚠️ ${esc(acc.name)}: 어제 지출 ${won(acc.ySpend)} — 평소(${won(acc.prevSpendAvg)}) 대비 ${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`);
        }
      }
    }
  }
  // 3) 광고 거부/문제
  for (const ad of adsQ.data ?? []) {
    if (ad.effective_status === "DISAPPROVED") alerts.push(`🚫 광고 거부됨: ${esc(ad.name ?? ad.meta_ad_id)}`);
    else if (ad.effective_status === "WITH_ISSUES") alerts.push(`⚠️ 광고 문제 있음: ${esc(ad.name ?? ad.meta_ad_id)}`);
  }

  // 대기 추천 요약 (hold 제외)
  const actionCounts = new Map<ActionType, number>();
  for (const r of pending) {
    if (r.actionType === "hold") continue;
    // 이미 꺼진 세트는 조치할 게 없다 — 브리핑 숫자에서도 뺀다(상태 미상은 통과).
    if (r.adset?.status && r.adset.status !== "ACTIVE") continue;
    actionCounts.set(r.actionType, (actionCounts.get(r.actionType) ?? 0) + 1);
  }
  const recSummary = [...actionCounts.entries()]
    .map(([a, n]) => `${ACTION_LABEL_KO[a] ?? a} ${n}`)
    .join(" · ");

  // 본문 조립
  const lines: string[] = [`📊 <b>광고 아침 브리핑</b> (${yesterday})`];
  for (const acc of accs.values()) {
    if (acc.ySpend <= 0 && acc.prevSpendAvg <= 0) continue;
    const roas = acc.ySpend > 0 ? acc.yRevenue / acc.ySpend : 0;
    const mark = acc.ySpend <= 0 ? "⚪" : roas >= be ? "🟢" : roas >= be * 0.7 ? "🟡" : "🔴";
    lines.push(`${mark} <b>${esc(acc.name)}</b> — 지출 ${won(acc.ySpend)} · 매출 ${won(acc.yRevenue)} · ROAS ${acc.ySpend > 0 ? roas.toFixed(2) : "-"} · 전환 ${acc.yConv}`);
  }
  if (lines.length === 1) lines.push("어제 광고 데이터 없음 (계정 비활성?)");
  if (alerts.length) {
    lines.push("");
    lines.push(...alerts.slice(0, 6));
    if (alerts.length > 6) lines.push(`… 외 ${alerts.length - 6}건`);
  }
  lines.push("");
  lines.push(recSummary
    ? `🧠 대기 추천: ${recSummary} → <a href="https://paulvice-dashboard.vercel.app/ads">/ads에서 처리</a>`
    : `🧠 대기 추천 없음 — <a href="https://paulvice-dashboard.vercel.app/ads">현황판 보기</a>`);

  await sendTelegramMessage(lines.join("\n"));
  return { sent: true };
}
