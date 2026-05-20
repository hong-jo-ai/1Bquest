/**
 * 바이소이 × 폴바이스 공구 일일 판매 리포트.
 *
 * - 통합 상품 product_no = 226 (kv_store 'bysoy_consolidated:product')
 * - 옵션 추가금 포함 단가 계산: product_price + option_price - 할인
 * - 반품/취소 수량(claim_quantity) 차감
 * - PDF 한 페이지 — Pretendard 폰트 임베드
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { fetchAllOrders, lineItemRevenue } from "./cafe24Data";
import { getCsSupabase } from "./cs/store";

const BYSOY_KV_KEY = "bysoy_consolidated:product";

interface OrderItem {
  product_no?: number | string;
  product_code?: string;
  product_name?: string;
  option_value?: string;
  variant_code?: string;
  quantity?: number | string;
  actual_quantity?: number | string;
  claim_quantity?: number | string;
  product_price?: string | number;
  option_price?: string | number;
  coupon_discount_price?: string | number;
  additional_discount_price?: string | number;
}

interface Order {
  order_id?: string;
  order_date?: string;
  order_status?: string;
  items?: OrderItem[];
}

export interface ModelLine {
  model:    string;
  qty:      number;
  revenue:  number;
  orders:   number;
}

export interface BysoyReport {
  snapshotAt:   string;     // ISO
  periodStart:  string;     // YYYY-MM-DD (KST)
  periodEnd:    string;
  productNo:    number;
  productCode:  string;
  productName:  string;
  orders:       number;
  qty:          number;
  revenue:      number;
  byModel:      ModelLine[];
}

function krw(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

function kstNow(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}

function kstDate(offsetDays = 0): string {
  const ms = Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 통합 상품 메타 + 주문 → 모델별 집계.
 *
 * opts.date 지정 시 그 하루(KST)만 집계 (일일 리포트). 미지정이면 상품 생성일~오늘 누적.
 */
export async function buildBysoyReport(
  token: string,
  opts: { date?: string } = {},
): Promise<BysoyReport> {
  // 1) kv_store 에서 통합 상품 정보
  const db = getCsSupabase();
  const { data: row } = await db
    .from("kv_store")
    .select("data")
    .eq("key", BYSOY_KV_KEY)
    .maybeSingle();
  const consolidated = row?.data as
    | { createdAt?: string; productNo?: number; productCode?: string; productName?: string }
    | undefined;
  if (!consolidated?.productNo) {
    throw new Error(`바이소이 통합 상품 미설정 — kv_store '${BYSOY_KV_KEY}' 비어있음`);
  }

  const productNo = consolidated.productNo;
  const productCode = consolidated.productCode ?? "";
  const productName = consolidated.productName ?? "폴바이스 × @_bysoy 공동구매";

  // 2) 주문 조회 — opts.date 있으면 그 하루만, 없으면 상품 생성일~오늘 누적
  const periodStart = opts.date ?? (consolidated.createdAt ?? "2026-04-30").slice(0, 10);
  const periodEnd   = opts.date ?? kstDate(0);
  const all = (await fetchAllOrders(token, periodStart, periodEnd, true)) as Order[];

  // 3) 통합 상품 포함 주문 + 모델별 집계
  const byOption = new Map<string, ModelLine>();
  let totalQty = 0;
  let totalRevenue = 0;
  const orderIdsSet = new Set<string>();

  const target = String(productNo);
  for (const o of all) {
    const st = (o.order_status ?? "").trim();
    if (/취소|환불|반품/.test(st)) continue;

    for (const it of o.items ?? []) {
      const isBysoy =
        String(it.product_no ?? "") === target ||
        (it.product_code ?? "") === productCode;
      if (!isBysoy) continue;

      const rawQty   = Number(it.actual_quantity ?? it.quantity ?? 0) || 0;
      const claimQty = Number(it.claim_quantity ?? 0) || 0;
      const qty      = Math.max(0, rawQty - claimQty);
      if (qty === 0) continue;

      const lineRevenue = lineItemRevenue(it);

      // "시계 모델=..." prefix 제거
      const model = (it.option_value ?? "")
        .trim()
        .replace(/^시계\s*모델\s*=\s*/, "")
        .replace(/^모델\s*=\s*/, "")
        || (it.product_name ?? "(옵션 없음)").trim();

      const a = byOption.get(model) ?? { model, qty: 0, revenue: 0, orders: 0 };
      a.qty += qty;
      a.revenue += lineRevenue;
      byOption.set(model, a);

      if (o.order_id) orderIdsSet.add(o.order_id);
      totalQty += qty;
      totalRevenue += lineRevenue;
    }
  }

  // orders count per model — 별도 set 으로 정확히
  const modelOrderSets = new Map<string, Set<string>>();
  for (const o of all) {
    const st = (o.order_status ?? "").trim();
    if (/취소|환불|반품/.test(st)) continue;
    for (const it of o.items ?? []) {
      const isBysoy =
        String(it.product_no ?? "") === target ||
        (it.product_code ?? "") === productCode;
      if (!isBysoy) continue;
      const model = (it.option_value ?? "")
        .trim()
        .replace(/^시계\s*모델\s*=\s*/, "")
        .replace(/^모델\s*=\s*/, "")
        || (it.product_name ?? "(옵션 없음)").trim();
      if (!modelOrderSets.has(model)) modelOrderSets.set(model, new Set());
      if (o.order_id) modelOrderSets.get(model)!.add(o.order_id);
    }
  }
  for (const line of byOption.values()) {
    line.orders = modelOrderSets.get(line.model)?.size ?? 0;
  }

  return {
    snapshotAt:  kstNow().toISOString(),
    periodStart,
    periodEnd,
    productNo,
    productCode,
    productName,
    orders:  orderIdsSet.size,
    qty:     totalQty,
    revenue: totalRevenue,
    byModel: [...byOption.values()].sort((a, b) => b.qty - a.qty),
  };
}

/** PDF 생성 — Buffer 반환. */
export async function renderBysoyReportPdf(r: BysoyReport): Promise<Buffer> {
  // pdfkit 의 기본 폰트 캐시 우회 — 우리는 한글 폰트만 등록해서 사용
  const fontRegular = readFileSync(
    join(process.cwd(), "lib/fonts/Pretendard-Regular.otf"),
  );
  const fontBold = readFileSync(
    join(process.cwd(), "lib/fonts/Pretendard-Bold.otf"),
  );

  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    info: {
      Title:    "바이소이 × 폴바이스 공구 판매 리포트",
      Author:   "Paulvice Dashboard",
      Subject:  `${r.periodStart} ~ ${r.periodEnd}`,
      Creator:  "Paulvice",
    },
  });

  doc.registerFont("KR",      fontRegular);
  doc.registerFont("KR-Bold", fontBold);

  const chunks: Buffer[] = [];
  doc.on("data",  (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ── 헤더 ─────────────────────────────────────
  doc.font("KR-Bold").fontSize(20).fillColor("#0F172A");
  doc.text("바이소이 × 폴바이스 공동구매");
  doc.moveDown(0.2);
  doc.font("KR").fontSize(11).fillColor("#475569");
  doc.text("일일 판매 리포트");
  doc.moveDown(0.4);

  // 메타
  const kstSnap = new Date(new Date(r.snapshotAt).getTime() + 9 * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16);
  doc.fontSize(10).fillColor("#64748B");
  doc.text(`집계 기간: ${r.periodStart} ~ ${r.periodEnd} (KST)`);
  doc.text(`스냅샷:   ${kstSnap} KST`);
  doc.moveDown(1);

  // ── 총계 박스 ────────────────────────────────
  const boxY = doc.y;
  doc.rect(48, boxY, doc.page.width - 96, 70).fill("#F1F5F9");
  doc.fillColor("#0F172A").font("KR-Bold").fontSize(11);
  const boxPad = 16;
  doc.text("총계", 48 + boxPad, boxY + boxPad);

  doc.font("KR").fontSize(10).fillColor("#475569");
  const cellW = (doc.page.width - 96 - boxPad * 2) / 3;
  doc.text("주문",  48 + boxPad,             boxY + boxPad + 18);
  doc.text("수량",  48 + boxPad + cellW,     boxY + boxPad + 18);
  doc.text("매출",  48 + boxPad + cellW * 2, boxY + boxPad + 18);

  doc.font("KR-Bold").fontSize(16).fillColor("#0F172A");
  doc.text(`${r.orders}건`, 48 + boxPad,             boxY + boxPad + 30);
  doc.text(`${r.qty}개`,    48 + boxPad + cellW,     boxY + boxPad + 30);
  doc.text(krw(r.revenue), 48 + boxPad + cellW * 2, boxY + boxPad + 30);

  doc.y = boxY + 70 + 24;

  // ── 모델별 테이블 ────────────────────────────
  doc.font("KR-Bold").fontSize(13).fillColor("#0F172A");
  doc.text("모델별 판매 (수량 내림차순)", 48);
  doc.moveDown(0.5);

  // 헤더
  const tableX = 48;
  const tableW = doc.page.width - 96;
  const colWModel = tableW * 0.55;
  const colWQty   = tableW * 0.12;
  const colWOrd   = tableW * 0.13;
  const colWRev   = tableW * 0.20;

  let y = doc.y;
  doc.fillColor("#0F172A").font("KR-Bold").fontSize(10);
  doc.text("모델",   tableX,                                       y, { width: colWModel });
  doc.text("수량",   tableX + colWModel,                           y, { width: colWQty,  align: "right" });
  doc.text("주문",   tableX + colWModel + colWQty,                 y, { width: colWOrd,  align: "right" });
  doc.text("매출",   tableX + colWModel + colWQty + colWOrd,       y, { width: colWRev,  align: "right" });
  y += 18;
  doc.moveTo(tableX, y - 4).lineTo(tableX + tableW, y - 4).strokeColor("#CBD5E1").lineWidth(0.5).stroke();

  // 행
  doc.font("KR").fontSize(10).fillColor("#0F172A");
  if (r.byModel.length === 0) {
    doc.fillColor("#94A3B8");
    doc.text("(아직 판매 없음)", tableX, y);
    y += 18;
  } else {
    for (const m of r.byModel) {
      doc.fillColor("#0F172A").font("KR").fontSize(10);
      doc.text(m.model,      tableX,                                       y, { width: colWModel });
      doc.text(`${m.qty}개`,  tableX + colWModel,                           y, { width: colWQty, align: "right" });
      doc.text(`${m.orders}건`, tableX + colWModel + colWQty,               y, { width: colWOrd, align: "right" });
      doc.text(krw(m.revenue), tableX + colWModel + colWQty + colWOrd,      y, { width: colWRev, align: "right" });
      y += 18;
      doc.moveTo(tableX, y - 4).lineTo(tableX + tableW, y - 4).strokeColor("#F1F5F9").lineWidth(0.5).stroke();
    }
  }

  // ── 푸터 ─────────────────────────────────────
  doc.fillColor("#94A3B8").font("KR").fontSize(9);
  doc.text(
    "본 자료는 카페24 결제완료 주문 기준이며, 취소·환불·반품 건은 제외됩니다.",
    48,
    doc.page.height - 60,
    { width: doc.page.width - 96 },
  );

  doc.end();
  return done;
}
