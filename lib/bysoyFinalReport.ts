/**
 * 바이소이 × 폴바이스 공구 최종(마감) 보고서.
 *
 * 일일 리포트(lib/bysoyReport.ts)와 달리 공구를 종결짓는 정산용 1페이지+ 문서.
 *  - 확정 판매 총계 + 모델별
 *  - 배송 현황(완료/배송중/준비중/보류) 내역
 *  - 반품·취소 내역
 *  - 에끌라 오벌 실버 배송보류 안내(재입고 지연 → 6/4 출고)
 *
 * 집계 규칙은 lib/bysoyReport / cafe24Data 와 동일 — 단가 = product_price+option_price-할인,
 * 반품/취소는 매출 제외. 카페24 아이템 status_text(N/C/R/E 코드) 로 배송·클레임 상태 분류.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { fetchAllOrders, lineItemRevenue } from "./cafe24Data";
import { getCsSupabase } from "./cs/store";

const BYSOY_KV_KEY = "bysoy_consolidated:product";
const BYSOY_START_DATE = "2026-05-19";

export interface FinalModelLine { model: string; qty: number; revenue: number; orders: number }
export interface FinalShipLine { status: string; qty: number; orders: number }
export interface FinalClaimLine { orderId: string; status: string; model: string; date: string }

export interface BysoyFinalReport {
  snapshotAt: string;
  periodStart: string;
  periodEnd: string;
  productNo: number;
  productName: string;
  orders: number;          // 확정 주문 수
  qty: number;             // 확정 수량
  revenue: number;         // 확정 매출
  byModel: FinalModelLine[];
  byShip: FinalShipLine[];
  returns: FinalClaimLine[];   // 반품
  cancels: FinalClaimLine[];   // 취소/환불
  silverHoldOrders: number;    // 실버 배송 대기 주문 수
  silverHoldQty: number;       // 실버 배송 대기 수량
  restockOrigin: string;       // 당초 재입고일
  restockDelayed: string;      // 지연된 출고일
}

function krw(n: number): string { return n.toLocaleString("ko-KR") + "원"; }
function kstNow(): Date { return new Date(Date.now() + 9 * 3600 * 1000); }
function kstDate(off = 0): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + off * 86400 * 1000).toISOString().slice(0, 10);
}

function cleanModel(opt?: string): string {
  return (opt ?? "").trim()
    .replace(/^시계\s*모델\s*=\s*/, "").replace(/^모델\s*=\s*/, "")
    .replace(/4월\s*29일\s*출고예정/, "5월29일 출고예정").trim();
}

/** 출고예정 접미사 제거 — 모델별 합산용(실버 5/29 + 실버를 한 줄로). */
function baseModel(opt: string): string {
  return opt.replace(/\s*\([^)]*출고예정\)\s*/g, "").trim();
}

export async function buildBysoyFinalReport(
  token: string,
  opts: { restockOrigin?: string; restockDelayed?: string } = {},
): Promise<BysoyFinalReport> {
  const db = getCsSupabase();
  const { data: row } = await db.from("kv_store").select("data").eq("key", BYSOY_KV_KEY).maybeSingle();
  const consolidated = row?.data as
    | { createdAt?: string; productNo?: number; productCode?: string; productName?: string }
    | undefined;
  if (!consolidated?.productNo) throw new Error(`통합 상품 미설정 — kv_store '${BYSOY_KV_KEY}'`);

  const productNo = consolidated.productNo;
  const productCode = consolidated.productCode ?? "";
  const productName = consolidated.productName ?? "폴바이스 × @_bysoy 공동구매";

  const periodStart = (consolidated.createdAt ?? "2026-05-01").slice(0, 10);
  const periodEnd = kstDate(0);
  const all = (await fetchAllOrders(token, periodStart, periodEnd, true)) as any[];
  const target = String(productNo);

  const byModel = new Map<string, { qty: number; revenue: number; orders: Set<string> }>();
  const byShip = new Map<string, { qty: number; orders: Set<string> }>();
  const returns: FinalClaimLine[] = [];
  const cancels: FinalClaimLine[] = [];
  const orderIds = new Set<string>();
  let totalQty = 0, totalRevenue = 0;
  let silverHoldOrders = new Set<string>(), silverHoldQty = 0;
  let minDate: string | null = null, maxDate: string | null = null;

  for (const o of all) {
    for (const it of o.items ?? []) {
      const isBysoy = String(it.product_no ?? "") === target || (it.product_code ?? "") === productCode;
      if (!isBysoy) continue;
      if (/^\s*쇼핑백/.test(it.option_value ?? "")) continue;

      const opt = cleanModel(it.option_value);
      const statusText = (it.status_text ?? "").toString();
      const rawQty = Number(it.actual_quantity ?? it.quantity ?? 0) || 0;
      const claimQty = Number(it.claim_quantity ?? 0) || 0;

      // 반품/취소 — 매출 제외, 내역만 기록.
      // status_text(카페24 상태 텍스트)가 권위: 반품은 'R'코드(반품처리중/반품완료),
      // 취소는 'C'코드(취소완료). 카페24가 반품 건에도 cancel_date 를 채우는 경우가 있어
      // 날짜 필드보다 status_text 를 먼저 본다. status_text 가 비면 날짜로 폴백.
      if (/반품/.test(statusText) || (!statusText && (it.return_request_date || it.return_confirmed_date))) {
        returns.push({ orderId: o.order_id, status: statusText || "반품", model: baseModel(opt),
          date: (it.return_confirmed_date ?? it.return_request_date ?? "").toString().slice(0, 10) });
        continue;
      }
      if (/취소|환불/.test(statusText) || it.cancel_date || o.canceled === "T") {
        cancels.push({ orderId: o.order_id, status: statusText || "취소", model: baseModel(opt),
          date: (it.cancel_date ?? it.refund_date ?? "").toString().slice(0, 10) });
        continue;
      }

      const qty = Math.max(0, rawQty - claimQty);
      if (qty === 0) continue;
      const rev = lineItemRevenue(it);
      const mk = baseModel(opt);

      const m = byModel.get(mk) ?? { qty: 0, revenue: 0, orders: new Set<string>() };
      m.qty += qty; m.revenue += rev; if (o.order_id) m.orders.add(o.order_id); byModel.set(mk, m);

      const sk = statusText || "(상태없음)";
      const s = byShip.get(sk) ?? { qty: 0, orders: new Set<string>() };
      s.qty += qty; if (o.order_id) s.orders.add(o.order_id); byShip.set(sk, s);

      // 실버 배송 대기(보류/준비중)
      if (/실버/.test(opt) && /배송보류|배송준비/.test(statusText)) {
        if (o.order_id) silverHoldOrders.add(o.order_id);
        silverHoldQty += qty;
      }

      totalQty += qty; totalRevenue += rev; if (o.order_id) orderIds.add(o.order_id);
      const day = (o.order_date ?? "").slice(0, 10);
      const d = day && day < BYSOY_START_DATE ? BYSOY_START_DATE : day;
      if (d) { if (!minDate || d < minDate) minDate = d; if (!maxDate || d > maxDate) maxDate = d; }
    }
  }

  // 배송 상태 정렬 순서
  const order = ["배송완료", "배송중", "배송준비중", "배송보류", "교환신청", "(상태없음)"];
  const byShipArr: FinalShipLine[] = [...byShip.entries()]
    .map(([status, v]) => ({ status, qty: v.qty, orders: v.orders.size }))
    .sort((a, b) => (order.indexOf(a.status) + 100 * (order.indexOf(a.status) < 0 ? 1 : 0))
      - (order.indexOf(b.status) + 100 * (order.indexOf(b.status) < 0 ? 1 : 0)));

  return {
    snapshotAt: kstNow().toISOString(),
    periodStart: minDate ?? periodStart,
    periodEnd: maxDate ?? periodEnd,
    productNo, productName,
    orders: orderIds.size, qty: totalQty, revenue: totalRevenue,
    byModel: [...byModel.entries()]
      .map(([model, m]) => ({ model, qty: m.qty, revenue: m.revenue, orders: m.orders.size }))
      .sort((a, b) => b.qty - a.qty),
    byShip: byShipArr,
    returns, cancels,
    silverHoldOrders: silverHoldOrders.size, silverHoldQty,
    restockOrigin: opts.restockOrigin ?? "5월 29일",
    restockDelayed: opts.restockDelayed ?? "6월 4일",
  };
}

export async function renderBysoyFinalReportPdf(r: BysoyFinalReport): Promise<Buffer> {
  const fontRegular = readFileSync(join(process.cwd(), "lib/fonts/Pretendard-Regular.otf"));
  const fontBold = readFileSync(join(process.cwd(), "lib/fonts/Pretendard-Bold.otf"));

  const doc = new PDFDocument({
    size: "A4", margin: 48,
    info: { Title: "바이소이 × 폴바이스 공구 최종 보고서", Author: "Paulvice Dashboard",
      Subject: `${r.periodStart} ~ ${r.periodEnd}`, Creator: "Paulvice" },
  });
  doc.registerFont("KR", fontRegular);
  doc.registerFont("KR-Bold", fontBold);

  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const PAGE_W = doc.page.width;
  const M = 48;
  const tableW = PAGE_W - M * 2;

  // ── 헤더 ──
  doc.font("KR-Bold").fontSize(20).fillColor("#0F172A").text("바이소이 × 폴바이스 공동구매");
  doc.moveDown(0.2);
  doc.font("KR-Bold").fontSize(13).fillColor("#2563EB").text("공구 마감 보고서 (1차)");
  doc.moveDown(0.4);
  const kstSnap = new Date(new Date(r.snapshotAt).getTime() + 9 * 3600 * 1000)
    .toISOString().replace("T", " ").slice(0, 16);
  doc.font("KR").fontSize(10).fillColor("#64748B");
  doc.text(`판매 기간: ${r.periodStart} ~ ${r.periodEnd} (KST)`);
  doc.text(`작성: ${kstSnap} KST · 카페24 결제완료 주문 기준`);
  doc.moveDown(1);

  // ── 총계 박스 ──
  const boxY = doc.y;
  doc.rect(M, boxY, tableW, 72).fill("#F1F5F9");
  doc.fillColor("#0F172A").font("KR-Bold").fontSize(11).text("확정 판매 총계", M + 16, boxY + 14);
  const cellW = (tableW - 32) / 3;
  doc.font("KR").fontSize(10).fillColor("#475569");
  doc.text("주문", M + 16, boxY + 34);
  doc.text("수량", M + 16 + cellW, boxY + 34);
  doc.text("매출", M + 16 + cellW * 2, boxY + 34);
  doc.font("KR-Bold").fontSize(16).fillColor("#0F172A");
  doc.text(`${r.orders}건`, M + 16, boxY + 46);
  doc.text(`${r.qty}개`, M + 16 + cellW, boxY + 46);
  doc.text(krw(r.revenue), M + 16 + cellW * 2, boxY + 46);
  doc.y = boxY + 72 + 8;
  doc.font("KR").fontSize(9).fillColor("#94A3B8")
    .text("※ 반품·취소 건 제외. 교환건은 포함.", M, doc.y);
  doc.moveDown(1);

  const sectionTitle = (t: string) => {
    doc.font("KR-Bold").fontSize(13).fillColor("#0F172A").text(t, M);
    doc.moveDown(0.4);
  };
  const hr = (y: number, color = "#CBD5E1") =>
    doc.moveTo(M, y).lineTo(M + tableW, y).strokeColor(color).lineWidth(0.5).stroke();

  // ── 모델별 ──
  sectionTitle("모델별 판매");
  {
    const c0 = tableW * 0.58, c1 = tableW * 0.12, c2 = tableW * 0.12, c3 = tableW * 0.18;
    let y = doc.y;
    doc.font("KR-Bold").fontSize(10).fillColor("#0F172A");
    doc.text("모델", M, y, { width: c0 });
    doc.text("수량", M + c0, y, { width: c1, align: "right" });
    doc.text("주문", M + c0 + c1, y, { width: c2, align: "right" });
    doc.text("매출", M + c0 + c1 + c2, y, { width: c3, align: "right" });
    y += 17; hr(y - 4);
    doc.font("KR").fontSize(10);
    for (const m of r.byModel) {
      doc.fillColor("#0F172A");
      doc.text(m.model, M, y, { width: c0 });
      doc.text(`${m.qty}개`, M + c0, y, { width: c1, align: "right" });
      doc.text(`${m.orders}건`, M + c0 + c1, y, { width: c2, align: "right" });
      doc.text(krw(m.revenue), M + c0 + c1 + c2, y, { width: c3, align: "right" });
      y += 17; hr(y - 4, "#F1F5F9");
    }
    doc.y = y + 14;
  }

  // ── 배송 현황 ──
  sectionTitle("배송 현황");
  {
    const c0 = tableW * 0.6, c1 = tableW * 0.2, c2 = tableW * 0.2;
    let y = doc.y;
    doc.font("KR-Bold").fontSize(10).fillColor("#0F172A");
    doc.text("상태", M, y, { width: c0 });
    doc.text("수량", M + c0, y, { width: c1, align: "right" });
    doc.text("주문", M + c0 + c1, y, { width: c2, align: "right" });
    y += 17; hr(y - 4);
    doc.font("KR").fontSize(10);
    for (const s of r.byShip) {
      doc.fillColor(s.status === "배송보류" ? "#DC2626" : "#0F172A");
      doc.text(s.status, M, y, { width: c0 });
      doc.text(`${s.qty}개`, M + c0, y, { width: c1, align: "right" });
      doc.text(`${s.orders}건`, M + c0 + c1, y, { width: c2, align: "right" });
      y += 17; hr(y - 4, "#F1F5F9");
    }
    doc.y = y + 14;
  }

  // ── 반품·취소 ──
  sectionTitle("반품 · 취소 내역");
  {
    doc.font("KR").fontSize(10).fillColor("#475569");
    doc.text(`반품 ${r.returns.length}건 · 취소 ${r.cancels.length}건 (위 총계에서 이미 제외됨)`, M);
    doc.moveDown(0.3);
    const rows = [
      ...r.returns.map((x) => ({ tag: "반품", ...x })),
      ...r.cancels.map((x) => ({ tag: "취소", ...x })),
    ];
    doc.fontSize(9.5).fillColor("#64748B");
    for (const x of rows) {
      doc.text(`· [${x.tag}] ${x.model} — ${x.orderId} (${x.status}${x.date ? ", " + x.date : ""})`, M, doc.y, { width: tableW });
    }
    if (rows.length === 0) doc.text("· 없음", M);
    doc.moveDown(1);
  }

  // ── 에끌라 오벌 실버 배송 안내 ──
  {
    const boxY2 = doc.y;
    const boxH = 96;
    doc.rect(M, boxY2, tableW, boxH).fill("#FEF2F2");
    doc.rect(M, boxY2, 4, boxH).fill("#DC2626");
    doc.fillColor("#991B1B").font("KR-Bold").fontSize(12)
      .text("⚠ 에끌라 오벌 실버 — 재입고 일정 안내", M + 16, boxY2 + 12);
    doc.font("KR").fontSize(10).fillColor("#7F1D1D");
    doc.text(
      `에끌라 오벌 실버 컬러 ${r.silverHoldOrders}주문(${r.silverHoldQty}개)이 현재 재고 소진으로 배송 보류 중입니다. ` +
      `당초 ${r.restockOrigin} 재입고 후 즉시 출고 예정이었으나, 생산 공정 이슈로 ` +
      `출고일이 ${r.restockDelayed}로 조정되었습니다. 해당 물량 배송 완료 후 최종 정산을 진행합니다.`,
      M + 16, boxY2 + 34, { width: tableW - 32 },
    );
    doc.y = boxY2 + boxH + 14;
  }

  // ── 푸터 ──
  doc.fillColor("#94A3B8").font("KR").fontSize(9).text(
    "본 자료는 카페24 결제완료 주문 기준이며 취소·반품 건은 매출에서 제외됩니다. " +
    "실버 잔여 물량 배송 완료 시점에 최종(2차) 정산 자료를 전달드립니다.",
    M, doc.page.height - 64, { width: tableW },
  );

  doc.end();
  return done;
}
