/**
 * MADS 일일 리포트 — 매일 KST 09:30 cron으로 발송.
 *
 * 어제 매출/광고비/ROAS (Cafe24 + Meta) + MADS 추천 요약 + 임계값 정보.
 */
import { metaGet } from "../metaClient";
import { getMetaTokenServer } from "../metaTokenStore";
import { getValidC24Token } from "../cafe24Auth";
import { getDashboardData } from "../cafe24Data";
import { sendGmailNotification } from "../cs/emailNotify";
import { listRecommendations, type RecRow } from "./dbStore";
import { getMarginConfig, resolveThresholds } from "./marginConfig";
import { getActiveSeasonModifier } from "./seasonModifier";
import { ACTION_LABEL_KO, TRUST_LABEL_KO } from "./ruleEngine";

function kstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function fmtKRW(n: number): string {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return (n / 10_000).toFixed(1) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(0) + "%";
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PURCHASE_ACTIONS = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

function sumPurchase(rows: { action_type: string; value: string }[] | undefined): number {
  if (!rows) return 0;
  let total = 0;
  for (const r of rows) {
    if (PURCHASE_ACTIONS.has(r.action_type)) {
      total = Math.max(total, parseFloat(r.value ?? "0"));
    }
  }
  return total;
}

interface MetaKpi { spend: number; purchaseValue: number; purchaseCount: number; roas: number }

async function fetchMetaKpi(token: string, since: string, until: string): Promise<MetaKpi> {
  const accountsRes = (await metaGet("/me/adaccounts", token, {
    fields: "id", limit: "20",
  })) as { data?: Array<{ id: string }> };

  let spend = 0, purchaseValue = 0, purchaseCount = 0;
  await Promise.all(
    (accountsRes.data ?? []).map(async (acc) => {
      try {
        const ins = (await metaGet(`/${acc.id}/insights`, token, {
          fields: "spend,actions,action_values",
          time_range: JSON.stringify({ since, until }),
          level: "account",
        })) as { data?: Array<{ spend?: string; actions?: { action_type: string; value: string }[]; action_values?: { action_type: string; value: string }[] }> };
        const row = ins.data?.[0];
        if (!row) return;
        spend         += parseFloat(row.spend ?? "0");
        purchaseValue += sumPurchase(row.action_values);
        purchaseCount += sumPurchase(row.actions);
      } catch (e) {
        console.error(`[mads-daily-report] meta ${acc.id} 실패:`, e);
      }
    }),
  );

  return {
    spend:         Math.round(spend),
    purchaseValue: Math.round(purchaseValue),
    purchaseCount: Math.round(purchaseCount),
    roas:          spend > 0 ? purchaseValue / spend : 0,
  };
}

function sumRange(daily: { date: string; revenue: number; orders: number }[], since: string, until: string) {
  let revenue = 0, orders = 0;
  for (const d of daily) {
    if (d.date >= since && d.date <= until) {
      revenue += d.revenue;
      orders  += d.orders;
    }
  }
  return { revenue, orders };
}

interface ReportData {
  yesterday: string;
  cafe24: { yest: { revenue: number; orders: number }; last7: { revenue: number; orders: number }; prev7: { revenue: number; orders: number } } | null;
  meta:    { yest: MetaKpi; last7: MetaKpi; prev7: MetaKpi } | null;
  pendingRecs: RecRow[];
  thresholds: ReturnType<typeof resolveThresholds>;
}

async function collectReportData(): Promise<ReportData> {
  const yesterday = kstDate(-1);
  const last7Since = kstDate(-7), last7Until = kstDate(-1);
  const prev7Since = kstDate(-14), prev7Until = kstDate(-8);

  const [cafe24Token, metaToken, pendingRecs, marginCfg, season] = await Promise.all([
    getValidC24Token(),
    getMetaTokenServer(),
    listRecommendations("pending", 200),
    getMarginConfig(),
    getActiveSeasonModifier(),
  ]);

  let cafe24 = null;
  if (cafe24Token) {
    try {
      const dash = await getDashboardData(cafe24Token);
      const daily = dash.dailyRevenue ?? [];
      cafe24 = {
        yest:  sumRange(daily, yesterday, yesterday),
        last7: sumRange(daily, last7Since, last7Until),
        prev7: sumRange(daily, prev7Since, prev7Until),
      };
    } catch (e) {
      console.error("[mads-daily-report] cafe24 실패:", e);
    }
  }

  let meta = null;
  if (metaToken) {
    try {
      const [yest, last7, prev7] = await Promise.all([
        fetchMetaKpi(metaToken, yesterday, yesterday),
        fetchMetaKpi(metaToken, last7Since, last7Until),
        fetchMetaKpi(metaToken, prev7Since, prev7Until),
      ]);
      meta = { yest, last7, prev7 };
    } catch (e) {
      console.error("[mads-daily-report] meta 실패:", e);
    }
  }

  return {
    yesterday, cafe24, meta, pendingRecs,
    thresholds: resolveThresholds(marginCfg, season),
  };
}

function buildHtml(data: ReportData, madsUrl: string): string {
  const { yesterday, cafe24, meta, pendingRecs, thresholds } = data;

  const cafe24Section = cafe24 ? `
    <tr><td style="padding:18px 20px 6px;font-size:12px;color:#888;font-weight:600;letter-spacing:.5px;text-transform:uppercase">실 매출 (Cafe24)</td></tr>
    <tr><td style="padding:0 20px 18px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td width="50%" style="padding:14px;background:#f9fafb;border-radius:10px;text-align:center">
            <div style="font-size:11px;color:#666;margin-bottom:4px">어제 매출</div>
            <div style="font-size:18px;font-weight:bold;color:#111">${fmtKRW(cafe24.yest.revenue)}</div>
            <div style="font-size:11px;color:#888;margin-top:2px">${cafe24.yest.orders}건 주문</div>
          </td>
          <td width="4"></td>
          <td width="50%" style="padding:14px;background:#f9fafb;border-radius:10px;text-align:center">
            <div style="font-size:11px;color:#666;margin-bottom:4px">최근 7일</div>
            <div style="font-size:18px;font-weight:bold;color:#111">${fmtKRW(cafe24.last7.revenue)}</div>
            <div style="font-size:11px;color:${cafe24.prev7.revenue > 0 && cafe24.last7.revenue > cafe24.prev7.revenue ? "#10b981" : "#ef4444"};margin-top:2px">전주 대비 ${fmtPct(cafe24.prev7.revenue > 0 ? (cafe24.last7.revenue - cafe24.prev7.revenue) / cafe24.prev7.revenue * 100 : 0)}</div>
          </td>
        </tr>
      </table>
    </td></tr>` : "";

  const metaSection = meta ? `
    <tr><td style="padding:6px 20px 6px;font-size:12px;color:#888;font-weight:600;letter-spacing:.5px;text-transform:uppercase">광고 (Meta)</td></tr>
    <tr><td style="padding:0 20px 18px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td width="25%" style="padding:10px 6px;background:#f9fafb;border-radius:10px;text-align:center">
            <div style="font-size:10px;color:#666;margin-bottom:3px">어제 광고비</div>
            <div style="font-size:14px;font-weight:bold;color:#111">${fmtKRW(meta.yest.spend)}</div>
          </td>
          <td width="4"></td>
          <td width="25%" style="padding:10px 6px;background:#f9fafb;border-radius:10px;text-align:center">
            <div style="font-size:10px;color:#666;margin-bottom:3px">어제 매출</div>
            <div style="font-size:14px;font-weight:bold;color:#111">${fmtKRW(meta.yest.purchaseValue)}</div>
          </td>
          <td width="4"></td>
          <td width="25%" style="padding:10px 6px;background:#f9fafb;border-radius:10px;text-align:center">
            <div style="font-size:10px;color:#666;margin-bottom:3px">어제 ROAS</div>
            <div style="font-size:14px;font-weight:bold;color:${meta.yest.roas >= thresholds.roasBase ? "#10b981" : meta.yest.roas >= thresholds.beRoas ? "#f59e0b" : "#ef4444"}">${meta.yest.roas > 0 ? meta.yest.roas.toFixed(2) + "x" : "-"}</div>
          </td>
          <td width="4"></td>
          <td width="25%" style="padding:10px 6px;background:#f9fafb;border-radius:10px;text-align:center">
            <div style="font-size:10px;color:#666;margin-bottom:3px">어제 전환</div>
            <div style="font-size:14px;font-weight:bold;color:#111">${meta.yest.purchaseCount}건</div>
          </td>
        </tr>
      </table>
      <div style="margin-top:8px;font-size:11px;color:#666">
        7일 누적: 광고비 <strong>${fmtKRW(meta.last7.spend)}</strong> · 매출 <strong>${fmtKRW(meta.last7.purchaseValue)}</strong> · ROAS <strong>${meta.last7.roas > 0 ? meta.last7.roas.toFixed(2) + "x" : "-"}</strong> · 전환 <strong>${meta.last7.purchaseCount}건</strong>
      </div>
    </td></tr>` : "";

  // 추천 액션 카운트
  const counts: Record<string, number> = {};
  const trustCounts: Record<string, number> = {};
  for (const r of pendingRecs) {
    counts[r.actionType] = (counts[r.actionType] ?? 0) + 1;
    if (r.trust) trustCounts[r.trust.level] = (trustCounts[r.trust.level] ?? 0) + 1;
  }

  const summarySection = pendingRecs.length > 0 ? `
    <tr><td style="padding:6px 20px 6px;font-size:12px;color:#888;font-weight:600;letter-spacing:.5px;text-transform:uppercase">대기 중 추천 (총 ${pendingRecs.length}건)</td></tr>
    <tr><td style="padding:0 20px 18px">
      <div style="font-size:13px;color:#444;line-height:1.7;margin-bottom:6px">
        ${counts.pause            ? `<span style="display:inline-block;background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">${ACTION_LABEL_KO.pause} ${counts.pause}</span>` : ""}
        ${counts.increase         ? `<span style="display:inline-block;background:#d1fae5;color:#065f46;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">${ACTION_LABEL_KO.increase} ${counts.increase}</span>` : ""}
        ${counts.duplicate        ? `<span style="display:inline-block;background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">${ACTION_LABEL_KO.duplicate} ${counts.duplicate}</span>` : ""}
        ${counts.creative_refresh ? `<span style="display:inline-block;background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">${ACTION_LABEL_KO.creative_refresh} ${counts.creative_refresh}</span>` : ""}
        ${counts.hold             ? `<span style="display:inline-block;background:#f3f4f6;color:#374151;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">${ACTION_LABEL_KO.hold} ${counts.hold}</span>` : ""}
      </div>
      <div style="font-size:11px;color:#666">
        신뢰도:
        ${trustCounts.trusted   ? `<strong style="color:#10b981">${TRUST_LABEL_KO.trusted} ${trustCounts.trusted}</strong> · ` : ""}
        ${trustCounts.learning  ? `<strong style="color:#f59e0b">${TRUST_LABEL_KO.learning} ${trustCounts.learning}</strong> · ` : ""}
        ${trustCounts.decaying  ? `<strong style="color:#ef4444">${TRUST_LABEL_KO.decaying} ${trustCounts.decaying}</strong> · ` : ""}
        ${trustCounts.untrusted ? `<strong style="color:#6b7280">${TRUST_LABEL_KO.untrusted} ${trustCounts.untrusted}</strong>` : ""}
      </div>
    </td></tr>` : "";

  // 액션 우선순위가 높은 것들 (pause / decaying / increase) 카드
  const priorityRecs = pendingRecs
    .filter((r) =>
      r.actionType === "pause" ||
      r.actionType === "creative_refresh" ||
      r.actionType === "increase" ||
      r.actionType === "duplicate",
    )
    .slice(0, 8);

  const recRows = priorityRecs.map((r) => {
    const color =
      r.actionType === "pause"            ? { bg: "#fef2f2", border: "#fecaca", text: "#991b1b" } :
      r.actionType === "creative_refresh" ? { bg: "#fffbeb", border: "#fde68a", text: "#92400e" } :
      r.actionType === "duplicate"        ? { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af" } :
                                            { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" };
    const trustLabel = r.trust ? TRUST_LABEL_KO[r.trust.level] : "-";
    const roas = r.trust ? r.trust.roas7d.toFixed(2) : "-";
    const spend = r.trust ? fmtKRW(r.trust.spend7d) : "-";
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid ${color.border};background:${color.bg}">
          <div style="font-size:13px;font-weight:600;color:${color.text}">[${ACTION_LABEL_KO[r.actionType]}] ${htmlEscape(r.adset?.name ?? r.metaAdsetId)}</div>
          <div style="font-size:11px;color:${color.text};margin-top:2px;opacity:0.85">
            ${htmlEscape(r.adset?.campaignName ?? "-")} · ${trustLabel} · 7d ROAS ${roas} · 지출 ${spend}
            ${r.recommendedBudget !== null && r.actionType !== "pause" ? ` · 추천 ${fmtKRW(r.recommendedBudget)}` : ""}
          </div>
        </td>
      </tr>`;
  }).join("");

  const recListSection = priorityRecs.length > 0 ? `
    <tr><td style="padding:6px 20px 6px;font-size:12px;color:#888;font-weight:600;letter-spacing:.5px;text-transform:uppercase">우선 처리 항목</td></tr>
    <tr><td style="padding:0 20px 18px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:10px;overflow:hidden">${recRows}</table>
    </td></tr>` : "";

  const thrSection = `
    <tr><td style="padding:6px 20px 18px;font-size:11px;color:#aaa;text-align:center">
      BE ROAS <strong>${thresholds.beRoas}</strong> ·
      종료 &lt;${thresholds.roasLow} ·
      증액 ≥${thresholds.roasBase} ·
      공격 증액 ≥${thresholds.roasHigh}
    </td></tr>`;

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:20px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:white;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <tr><td style="background:linear-gradient(135deg,#7c3aed,#c026d3);padding:22px 20px;color:white">
    <div style="font-size:11px;opacity:0.85;margin-bottom:4px;letter-spacing:.5px">PAULVICE · MADS</div>
    <div style="font-size:20px;font-weight:bold">${yesterday} 일일 리포트</div>
  </td></tr>
  ${cafe24Section}
  ${metaSection}
  ${summarySection}
  ${recListSection}
  ${thrSection}
  <tr><td style="padding:18px 20px;text-align:center;background:#fafafa;border-top:1px solid #f3f4f6">
    <a href="${madsUrl}" style="display:inline-block;background:#7c3aed;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">광고 의사결정 열기</a>
  </td></tr>
  <tr><td style="padding:10px;text-align:center;color:#bbb;font-size:10px">자동 발송 · KST 09:30 · MADS</td></tr>
</table>
</body></html>`;
}

export async function buildAndSendDailyReport(): Promise<{
  ok: boolean; to: string; subject: string;
  cafe24: boolean; meta: boolean;
  pendingTotal: number; pauseCount: number;
}> {
  const to = process.env.DAILY_REPORT_EMAIL ?? "jacobhong2@gmail.com";
  const data = await collectReportData();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://paulvice-dashboard.vercel.app";
  const html = buildHtml(data, `${appUrl}/ads`);

  const pauseCount  = data.pendingRecs.filter((r) => r.actionType === "pause").length;
  const subject = `[MADS] ${data.yesterday}` +
    (data.meta ? ` · ROAS ${data.meta.yest.roas > 0 ? data.meta.yest.roas.toFixed(2) + "x" : "-"}` : "") +
    (pauseCount > 0 ? ` · 종료 후보 ${pauseCount}` : "") +
    (data.pendingRecs.length > 0 ? ` · 대기 ${data.pendingRecs.length}` : "");

  await sendGmailNotification(to, subject, html);

  return {
    ok: true, to, subject,
    cafe24: data.cafe24 !== null,
    meta:   data.meta !== null,
    pendingTotal: data.pendingRecs.length,
    pauseCount,
  };
}
