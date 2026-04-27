/**
 * 매일 KST 09:30 cron — 어제 매출/광고비/ROAS + 자동예산 추천 요약 → 이메일.
 *
 * 데이터 소스:
 *   - Cafe24: getValidC24Token + getDashboardData (실 매출 / 주문 수)
 *   - Meta:   직접 /me/adaccounts → /:account/insights (광고비 / 광고 매출 / 전환)
 *   - 자동예산: Supabase meta_auto_budget_log (오늘 run_date)
 */
import { createClient } from "@supabase/supabase-js";
import { metaGet } from "./metaClient";
import { getMetaTokenFromStore } from "./metaTokenStore";
import { getValidC24Token } from "./cafe24Auth";
import { getDashboardData } from "./cafe24Data";
import { sendGmailNotification } from "./cs/emailNotify";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

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

interface MetaKpi {
  spend:         number;
  purchaseValue: number;
  purchaseCount: number;
  roas:          number;
}

async function fetchMetaKpi(
  token: string,
  since: string,
  until: string
): Promise<MetaKpi> {
  const accountsRes = (await metaGet("/me/adaccounts", token, {
    fields: "id",
    limit: "20",
  })) as { data?: Array<{ id: string }> };

  let spend = 0;
  let purchaseValue = 0;
  let purchaseCount = 0;

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
        console.error(`[daily-report] meta ${acc.id} 실패:`, e);
      }
    })
  );

  return {
    spend:         Math.round(spend),
    purchaseValue: Math.round(purchaseValue),
    purchaseCount: Math.round(purchaseCount),
    roas:          spend > 0 ? purchaseValue / spend : 0,
  };
}

interface BudgetRecLite {
  adset_name:    string | null;
  campaign_name: string | null;
  spend_7d:      number;
  roas_7d:       number;
  action:        string;
  applied:       boolean;
}

async function fetchTodayRecommendations(): Promise<{
  counts: Record<string, number>;
  pauseCandidates: BudgetRecLite[];
}> {
  const sb = getSupabase();
  if (!sb) return { counts: {}, pauseCandidates: [] };

  const { data } = await sb
    .from("meta_auto_budget_log")
    .select("adset_name,campaign_name,spend_7d,roas_7d,action,applied")
    .eq("run_date", kstDate(0));

  const rows = (data ?? []) as BudgetRecLite[];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.action] = (counts[r.action] ?? 0) + 1;

  const pauseCandidates = rows
    .filter((r) => r.action === "pause" && !r.applied)
    .sort((a, b) => a.roas_7d - b.roas_7d);

  return { counts, pauseCandidates };
}

function sumRange(daily: { date: string; revenue: number; orders: number }[], since: string, until: string) {
  let revenue = 0;
  let orders = 0;
  for (const d of daily) {
    if (d.date >= since && d.date <= until) {
      revenue += d.revenue;
      orders += d.orders;
    }
  }
  return { revenue, orders };
}

interface ReportData {
  yesterday: string;
  cafe24: {
    yest:     { revenue: number; orders: number };
    last7:    { revenue: number; orders: number };
    prev7:    { revenue: number; orders: number };
  } | null;
  meta: {
    yest:  MetaKpi;
    last7: MetaKpi;
    prev7: MetaKpi;
  } | null;
  rec: {
    counts: Record<string, number>;
    pauseCandidates: BudgetRecLite[];
  };
}

async function collectReportData(): Promise<ReportData> {
  const yesterday = kstDate(-1);
  const last7Since = kstDate(-7);
  const last7Until = kstDate(-1);
  const prev7Since = kstDate(-14);
  const prev7Until = kstDate(-8);

  // 병렬 fetch
  const [cafe24Token, metaToken, rec] = await Promise.all([
    getValidC24Token(),
    getMetaTokenFromStore(),
    fetchTodayRecommendations(),
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
      console.error("[daily-report] cafe24 실패:", e);
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
      console.error("[daily-report] meta 실패:", e);
    }
  }

  return { yesterday, cafe24, meta, rec };
}

function buildHtml(data: ReportData, autoUrl: string): string {
  const { yesterday, cafe24, meta, rec } = data;

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
            <div style="font-size:14px;font-weight:bold;color:${meta.yest.roas >= 2 ? "#10b981" : meta.yest.roas >= 1 ? "#f59e0b" : "#ef4444"}">${meta.yest.roas > 0 ? meta.yest.roas.toFixed(2) + "x" : "-"}</div>
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

  const c = rec.counts;
  const recCount = (c.pause ?? 0) + (c.increase ?? 0) + (c.decrease ?? 0) + (c.maintain ?? 0);
  const recSection = recCount > 0 ? `
    <tr><td style="padding:6px 20px 6px;font-size:12px;color:#888;font-weight:600;letter-spacing:.5px;text-transform:uppercase">자동예산 추천</td></tr>
    <tr><td style="padding:0 20px 18px">
      <div style="font-size:13px;color:#444;line-height:1.7">
        ${c.pause    ? `<span style="display:inline-block;background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">일시중지 ${c.pause}</span>` : ""}
        ${c.increase ? `<span style="display:inline-block;background:#d1fae5;color:#065f46;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">증액 ${c.increase}</span>` : ""}
        ${c.decrease ? `<span style="display:inline-block;background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">감액 ${c.decrease}</span>` : ""}
        ${c.maintain ? `<span style="display:inline-block;background:#f3f4f6;color:#374151;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-right:4px">유지 ${c.maintain}</span>` : ""}
      </div>
    </td></tr>` : "";

  const pauseRows = rec.pauseCandidates
    .map((r) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #fee2e2;background:#fef2f2">
          <div style="font-size:13px;font-weight:600;color:#991b1b">${htmlEscape(r.adset_name ?? "이름 없음")}</div>
          <div style="font-size:11px;color:#7f1d1d;margin-top:2px">${htmlEscape(r.campaign_name ?? "-")} · 7d 지출 ${fmtKRW(r.spend_7d)} · ROAS ${r.roas_7d.toFixed(2)}x</div>
        </td>
      </tr>`)
    .join("");

  const pauseSection = rec.pauseCandidates.length > 0 ? `
    <tr><td style="padding:6px 20px 6px;font-size:12px;color:#dc2626;font-weight:600;letter-spacing:.5px;text-transform:uppercase">⚠️ 일시중지 후보 ${rec.pauseCandidates.length}개</td></tr>
    <tr><td style="padding:0 20px 18px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-radius:10px;overflow:hidden">${pauseRows}</table>
    </td></tr>` : "";

  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f3f4f6;margin:0;padding:20px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:white;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
  <tr><td style="background:linear-gradient(135deg,#7c3aed,#c026d3);padding:22px 20px;color:white">
    <div style="font-size:11px;opacity:0.85;margin-bottom:4px;letter-spacing:.5px">PAULVICE DAILY</div>
    <div style="font-size:20px;font-weight:bold">${yesterday} 일일 리포트</div>
  </td></tr>
  ${cafe24Section}
  ${metaSection}
  ${recSection}
  ${pauseSection}
  <tr><td style="padding:18px 20px;text-align:center;background:#fafafa;border-top:1px solid #f3f4f6">
    <a href="${autoUrl}" style="display:inline-block;background:#7c3aed;color:white;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">광고 자동화 열기</a>
  </td></tr>
  <tr><td style="padding:10px;text-align:center;color:#bbb;font-size:10px">자동 발송 · KST 09:30</td></tr>
</table>
</body></html>`;
}

export async function buildAndSendDailyReport(): Promise<{
  ok: boolean;
  to: string;
  subject: string;
  cafe24: boolean;
  meta: boolean;
  recCount: number;
  pauseCount: number;
}> {
  const to = process.env.DAILY_REPORT_EMAIL ?? "jacobhong2@gmail.com";
  const data = await collectReportData();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://paulvice-dashboard.vercel.app";
  const html = buildHtml(data, `${appUrl}/ads/auto`);

  const c = data.rec.counts;
  const recCount = (c.pause ?? 0) + (c.increase ?? 0) + (c.decrease ?? 0) + (c.maintain ?? 0);
  const pauseCount = data.rec.pauseCandidates.length;

  const subject = `[일일 리포트] ${data.yesterday}` +
    (data.meta ? ` · 광고 ROAS ${data.meta.yest.roas > 0 ? data.meta.yest.roas.toFixed(2) + "x" : "-"}` : "") +
    (pauseCount > 0 ? ` · 일시중지 후보 ${pauseCount}` : "");

  await sendGmailNotification(to, subject, html);

  return {
    ok: true, to, subject,
    cafe24: data.cafe24 !== null,
    meta: data.meta !== null,
    recCount, pauseCount,
  };
}
