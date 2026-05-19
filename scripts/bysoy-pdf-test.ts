/**
 * 바이소이 PDF 리포트 로컬 테스트.
 *
 * 사용:
 *   npx tsx scripts/bysoy-pdf-test.ts                # PDF 만 만들고 /tmp 저장
 *   npx tsx scripts/bysoy-pdf-test.ts --send         # 텔레그램까지 발송
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

function loadEnvFile(p: string) {
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[key] = v;
  }
}

const ROOT = resolve(__dirname, "..");
loadEnvFile(join(ROOT, ".env.supabase"));
loadEnvFile(join(ROOT, ".env.local"));

const SEND = process.argv.includes("--send");

async function main() {
  const { getAccessTokenFromStore } = await import("../lib/cafe24TokenStore");
  const { buildBysoyReport, renderBysoyReportPdf } = await import("../lib/bysoyReport");

  const token = await getAccessTokenFromStore();
  if (!token) { console.error("no token"); process.exit(1); }

  console.log("[1/3] 데이터 집계…");
  const report = await buildBysoyReport(token);
  console.log(`  → 주문 ${report.orders}건 · 수량 ${report.qty}개 · 매출 ${report.revenue.toLocaleString()}원`);
  console.log(`  → 모델 ${report.byModel.length}종`);

  console.log("[2/3] PDF 생성…");
  const pdf = await renderBysoyReportPdf(report);
  const outPath = `/tmp/bysoy-report-${report.periodEnd}.pdf`;
  writeFileSync(outPath, pdf);
  console.log(`  → ${outPath} (${pdf.byteLength.toLocaleString()} bytes)`);

  if (SEND) {
    console.log("[3/3] 텔레그램 발송…");
    const { sendTelegramDocument } = await import("../lib/cs/telegramDocument");
    const { sendTelegramMessage } = await import("../lib/cs/telegram");
    const krw = (n: number) => n.toLocaleString("ko-KR") + "원";
    const top3 = report.byModel.slice(0, 3).map(
      (m) => `· ${m.model} — ${m.qty}개 / ${krw(m.revenue)}`,
    ).join("\n") || "(없음)";
    const caption = [
      `📊 <b>바이소이 공구 일일 리포트</b> (${report.periodEnd} KST)`,
      `· 누적 ${report.orders}건 · ${report.qty}개 · ${krw(report.revenue)}`,
      ``,
      `<b>TOP 3</b>`,
      top3,
      ``,
      `<i>※ 미리보기 — 자정에 실데이터 재생성 예정</i>`,
    ].join("\n");
    await sendTelegramDocument(pdf, `bysoy-report-${report.periodEnd}.pdf`, caption);

    const stockMsg = [
      `📝 <b>바이소이에게 전달할 멘트 (PDF 별첨)</b>`,
      ``,
      `안녕하세요 바이소이님 😊`,
      `${report.periodEnd}자 공구 판매 내역 정리해드립니다.`,
      ``,
      `⚠ <b>재고 안내</b>`,
      `에끌라 오벌 <b>실버 컬러</b>가 현재 재고 모두 소진되어 <b>5/29 재입고</b> 예정입니다.`,
      `이에 따라 <b>5/20 주문건부터는 5/29 일괄 출고</b>됨을 안내드릴게요.`,
    ].join("\n");
    await sendTelegramMessage(stockMsg);
    console.log("  → 발송 완료");
  } else {
    console.log("[3/3] --send 미지정, 발송 생략");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
