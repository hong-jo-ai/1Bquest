/**
 * 바이소이 공구 일일 판매 리포트 cron.
 *
 * 매일 자정(KST) 자동 실행. 카페24 누적 판매 데이터 → PDF + 텔레그램 발송.
 * 공구 종료일(BYSOY_END_DATE) 이후 +3일 지나면 자동 skip.
 *
 * 수동 호출: POST /api/cron/bysoy-daily-report?manual=1 (인증 X)
 * cron 호출:  GET  + Authorization: Bearer ${CRON_SECRET}
 */
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { buildBysoyReport, renderBysoyReportPdf, type BysoyReport } from "@/lib/bysoyReport";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { sendTelegramDocument } from "@/lib/cs/telegramDocument";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 공구 종료 + 3일 후 자동 비활성화 — 매일 발송 잘못 가는 것 방지.
const BYSOY_END_DATE = "2026-05-22";
const STOP_AFTER_DAYS = 3;

function kstDateStr(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function shouldSkip(): { skip: boolean; reason?: string } {
  const today = kstDateStr();
  const endTs = new Date(BYSOY_END_DATE + "T00:00:00+09:00").getTime();
  const stopTs = endTs + STOP_AFTER_DAYS * 86400 * 1000;
  const todayTs = new Date(today + "T00:00:00+09:00").getTime();
  if (todayTs > stopTs) {
    return { skip: true, reason: `공구 종료(${BYSOY_END_DATE}) + ${STOP_AFTER_DAYS}일 경과 — 자동 비활성화` };
  }
  return { skip: false };
}

function formatSummary(r: BysoyReport): string {
  const krw = (n: number) => n.toLocaleString("ko-KR") + "원";
  const top3 = r.byModel.slice(0, 3).map(
    (m) => `· ${m.model} — ${m.qty}개 / ${krw(m.revenue)}`,
  ).join("\n") || "<i>판매 없음</i>";
  const isDaily = r.periodStart === r.periodEnd;
  const header = isDaily
    ? `📊 <b>바이소이 공구 일일 리포트</b> (${r.periodEnd} 하루)`
    : `📊 <b>바이소이 공구 리포트</b> (${r.periodStart}~${r.periodEnd} 누적)`;
  const totalLine = isDaily
    ? `· ${r.orders}건 · ${r.qty}개 · ${krw(r.revenue)}`
    : `· 누적 ${r.orders}건 · ${r.qty}개 · ${krw(r.revenue)}`;
  return [
    header,
    totalLine,
    ``,
    `<b>TOP 3</b>`,
    top3,
    ``,
    `<i>상세는 첨부 PDF 참고. 바이소이님 전달용 자료입니다.</i>`,
  ].join("\n");
}

function formatStockNotice(r: BysoyReport): string {
  return [
    `📝 <b>바이소이에게 전달할 멘트 (PDF 별첨)</b>`,
    ``,
    `안녕하세요 바이소이님 😊`,
    `${r.periodEnd}자 공구 판매 내역 정리해드립니다.`,
    ``,
    `⚠ <b>재고 안내</b>`,
    `에끌라 오벌 <b>실버 컬러</b>가 현재 재고 모두 소진되어 <b>5/29 재입고</b> 예정입니다.`,
    `이에 따라 <b>5/20 주문건부터는 5/29 일괄 출고</b>됨을 안내드릴게요.`,
  ].join("\n");
}

async function run(opts: { manual?: boolean; date?: string } = {}) {
  const skip = shouldSkip();
  if (skip.skip && !opts.manual) {
    return Response.json({ ok: true, skipped: skip.reason });
  }

  const token = await getAccessTokenFromStore();
  if (!token) {
    return Response.json({ ok: false, error: "카페24 토큰 없음" }, { status: 500 });
  }

  const report = await buildBysoyReport(token, { date: opts.date });
  const pdf = await renderBysoyReportPdf(report);

  const filename = `bysoy-report-${report.periodEnd}.pdf`;
  await sendTelegramDocument(pdf, filename, formatSummary(report));
  await sendTelegramMessage(formatStockNotice(report));

  return Response.json({
    ok: true,
    periodEnd: report.periodEnd,
    orders:    report.orders,
    qty:       report.qty,
    revenue:   report.revenue,
    pdfBytes:  pdf.byteLength,
  });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    return await run();
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const manual = url.searchParams.get("manual") === "1";
  // ?date=YYYY-MM-DD — 그 하루(KST)만 집계해서 발송 (일일 리포트). 미지정이면 누적.
  const dateParam = url.searchParams.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : undefined;
  try {
    return await run({ manual, date });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
