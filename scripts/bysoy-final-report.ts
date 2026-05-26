/**
 * 바이소이 공구 최종(마감) 보고서 — PDF 생성 + 텔레그램 발송.
 *   npx tsx scripts/bysoy-final-report.ts            # PDF 만 /tmp 저장 + 메시지 미리보기
 *   npx tsx scripts/bysoy-final-report.ts --send     # 텔레그램까지 발송
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

function loadEnvFile(p: string) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
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
const krw = (n: number) => n.toLocaleString("ko-KR") + "원";

async function main() {
  const { getAccessTokenFromStore } = await import("../lib/cafe24TokenStore");
  const { buildBysoyFinalReport, renderBysoyFinalReportPdf } = await import("../lib/bysoyFinalReport");

  const token = await getAccessTokenFromStore();
  if (!token) { console.error("no token"); process.exit(1); }

  console.log("[1/3] 데이터 집계…");
  const r = await buildBysoyFinalReport(token, { restockOrigin: "5월 29일", restockDelayed: "6월 4일" });
  console.log(`  → 확정 ${r.orders}건 · ${r.qty}개 · ${krw(r.revenue)}`);
  console.log(`  → 반품 ${r.returns.length} · 취소 ${r.cancels.length} · 실버보류 ${r.silverHoldOrders}주문(${r.silverHoldQty}개)`);

  console.log("[2/3] PDF 생성…");
  const pdf = await renderBysoyFinalReportPdf(r);
  const outPath = `/tmp/bysoy-final-report-${r.periodEnd}.pdf`;
  writeFileSync(outPath, pdf);
  console.log(`  → ${outPath} (${pdf.byteLength.toLocaleString()} bytes)`);

  // 텔레그램 캡션 (사장님에게 — PDF 첨부)
  const top = r.byModel.slice(0, 5).map((m) => `· ${m.model} — ${m.qty}개`).join("\n");
  const caption = [
    `📋 <b>바이소이 공구 마감 보고서 (1차)</b>`,
    `판매기간 ${r.periodStart} ~ ${r.periodEnd}`,
    ``,
    `<b>확정 판매</b>: ${r.orders}건 · ${r.qty}개 · ${krw(r.revenue)}`,
    `<b>배송</b>: ${r.byShip.map((s) => `${s.status} ${s.qty}`).join(" / ")}`,
    `<b>반품</b> ${r.returns.length}건 · <b>취소</b> ${r.cancels.length}건`,
    ``,
    `<b>모델 TOP5</b>`,
    top,
    ``,
    `⚠ 에끌라 오벌 실버 ${r.silverHoldOrders}주문(${r.silverHoldQty}개) 배송보류 — 재입고 ${r.restockOrigin}→${r.restockDelayed} 지연. 배송완료 후 2차 정산.`,
  ].join("\n");

  // 바이소이에게 전달할 멘트 초안 (사장님이 검토 후 전달)
  const draft = [
    `📝 <b>바이소이님께 전달할 멘트 (초안)</b>`,
    ``,
    `안녕하세요 바이소이님 😊`,
    `이번 공동구매 1차 마감 내역 정리해서 보고서로 전달드려요.`,
    ``,
    `이번 공구 총 <b>${r.orders}건 · ${r.qty}개</b> 판매됐어요. 함께해주셔서 정말 감사합니다 🙏`,
    `반품은 ${r.returns.length}건, 취소 ${r.cancels.length}건 있었고 모두 정산에서 제외했습니다.`,
    ``,
    `한 가지 양해 부탁드릴 부분이 있어요.`,
    `<b>에끌라 오벌 실버</b> 컬러가 인기가 많아 재고가 모두 소진돼서, 현재 ${r.silverHoldOrders}분(${r.silverHoldQty}개)의 주문이 배송 대기 중이에요.`,
    `당초 <b>${r.restockOrigin}</b> 재입고 후 바로 출고 예정이었는데, 생산 과정에서 이슈가 하나 생겨 출고일이 <b>${r.restockDelayed}</b>로 조금 미뤄졌습니다.`,
    `고객분들껜 별도 안내드릴 예정이고, 실버 물량까지 배송이 완료되면 <b>최종(2차) 정산</b>으로 마무리하겠습니다.`,
    ``,
    `다시 한번 감사드려요! 🩷`,
  ].join("\n");

  if (SEND) {
    console.log("[3/3] 텔레그램 발송…");
    const { sendTelegramDocument } = await import("../lib/cs/telegramDocument");
    const { sendTelegramMessage } = await import("../lib/cs/telegram");
    await sendTelegramDocument(pdf, `바이소이공구_마감보고서_1차_${r.periodEnd}.pdf`, caption);
    await sendTelegramMessage(draft);
    console.log("  → 발송 완료");
  } else {
    console.log("\n========== [캡션 미리보기] ==========\n" + caption.replace(/<[^>]+>/g, ""));
    console.log("\n========== [전달 멘트 초안] ==========\n" + draft.replace(/<[^>]+>/g, ""));
    console.log("\n[3/3] --send 미지정, 발송 생략");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
