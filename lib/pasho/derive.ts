/**
 * 파쇼 발주(pasho:orders:v1)를 신제품 로드맵·발주(PO) 뷰로 파생.
 * 파쇼를 단일 원본으로 두고, 기존 두 시스템은 읽을 때 여기서 파생분을 합쳐 보여준다(이중입력 방지).
 *  - 개발/신규양산/리메이크 → 신제품 입고 로드맵(UpcomingProduct)
 *  - 리오더/후가공         → 발주·재입고(PurchaseOrder)
 */
import { getOrdersWithBalance } from "@/lib/pasho/store";
import type { UpcomingProduct } from "@/lib/upcomingProducts";
import type { PurchaseOrder } from "@/lib/purchaseOrders";
// 리드타임 기본값(값 임포트 사이클 회피 위해 인라인)
const DEFAULT_LEAD_MIN_DAYS = 14;
const DEFAULT_LEAD_MAX_DAYS = 21;

const STAGES = ["디자인", "샘플", "컨펌", "생산중", "검품", "납품", "입고", "정산"];
const brandKo = (b: string) => (b === "HR" ? "해리엇" : b === "KW" ? "기원" : "폴바이스");

/** 모델명 정규화 — 수동/파쇼 중복 판별용 */
export function normKey(s: string): string {
  return (s || "")
    .replace(/\(.*?\)|[\s\-·]|시계|워치|모델|폴바이스|해리엇|골드|실버|블랙|화이트|다이얼/g, "")
    .toLowerCase();
}

/** 개발/신규양산/리메이크 → 신제품 로드맵 */
export async function pashoToUpcoming(): Promise<UpcomingProduct[]> {
  const orders = await getOrdersWithBalance();
  const roadmap = new Set(["개발", "신규양산", "리메이크", "개발/양산"]);
  return orders
    .filter((o) => roadmap.has(o.type))
    .map((o) => {
      const curIdx = Math.max(0, STAGES.indexOf(o.status));
      const arrived = ["입고", "정산"].includes(o.status);
      const milestones = STAGES.slice(0, Math.min(curIdx + 2, STAGES.length)).map((label, i) => ({
        label,
        date: i <= curIdx ? o.date : "",
        done: i <= curIdx,
        note: i === curIdx ? "현재 단계" : null,
      }));
      return {
        id: `pasho:${o.no}`,
        brand: brandKo(o.brand),
        name: o.model,
        category: "시계",
        milestones,
        status: (arrived ? "arrived" : "tracking") as UpcomingProduct["status"],
        notes: `[파쇼 ${o.no}] ${o.note || ""}`.trim(),
        createdAt: `${o.date}T00:00:00Z`,
        updatedAt: new Date().toISOString(),
        derived: true,
      } satisfies UpcomingProduct;
    });
}

/** 리오더/후가공 → 발주·재입고(PO) */
export async function pashoToPurchaseOrders(): Promise<PurchaseOrder[]> {
  const orders = await getOrdersWithBalance();
  const poTypes = new Set(["리오더", "후가공"]);
  return orders
    .filter((o) => poTypes.has(o.type))
    .map((o) => {
      const received = o.receivedQty ?? 0;
      const done = (o.remainingQty ?? o.orderedQty) === 0 && received > 0;
      const firstSku = o.cafe24Map ? Object.values(o.cafe24Map)[0] : undefined;
      return {
        id: `pasho:${o.no}`,
        sku: firstSku ? String(firstSku.productNo) : "",
        productName: o.model,
        supplier: "파쇼",
        orderDate: o.date,
        qty: o.orderedQty,
        unitPrice: null,
        amount: null,
        leadMinDays: DEFAULT_LEAD_MIN_DAYS,
        leadMaxDays: DEFAULT_LEAD_MAX_DAYS,
        status: (done ? "received" : "ordered") as PurchaseOrder["status"],
        receivedDate: null,
        receivedQty: received || null,
        stockApplied: !!(o.cafe24Map && received > 0),
        notes: `[파쇼 ${o.no}] ${o.lines.map((l) => `${l.variant} ${l.received ?? 0}/${l.qty}`).join(", ")}`,
        createdAt: `${o.date}T00:00:00Z`,
        updatedAt: new Date().toISOString(),
        derived: true,
      } satisfies PurchaseOrder;
    });
}

/** 파쇼 파생 우선 + 수동분 중 모델명 겹치는 것 제외 */
export function mergeDedup<T extends { name?: string; productName?: string }>(manual: T[], derived: T[]): T[] {
  const dk = new Set(derived.map((d) => normKey(d.name || d.productName || "")));
  const kept = manual.filter((m) => !dk.has(normKey(m.name || m.productName || "")));
  return [...derived, ...kept];
}
