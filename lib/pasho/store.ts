/**
 * 파쇼 발주/입고 저장소 — kv_store 기반 (경량, 단일 사용자).
 *  - pasho:orders:v1   : 발주 6건 시드 (원장 소스)
 *  - pasho:receipts:v1 : 입고 이벤트 누적 (색상별 라인 단위)
 *
 * 입고는 발주수량보다 적게 들어오는 경우가 잦아(부분입고), 색상별 누적·잔량을 계산한다.
 * 카페24 재고 연동은 라인에 cafe24 매핑이 있을 때만 반영(신규 미런칭 모델은 매핑 없음).
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface Cafe24Map { productNo: number; variantCode?: string; mall?: "paulvice" | "harriot" }
export interface OrderLine { variant: string; qty: number; cafe24?: Cafe24Map | null }
export interface DevBrief {
  concept?: string; refs?: string; targetSpec?: { k: string; v: string }[];
  sampleQty?: string; prodQty?: string; schedule?: string; reqNotes?: string;
}
export interface PashoOrder {
  no: string; brand: "PV" | "HR" | "KW"; model: string; code: string; type: string;
  status: string; consign: boolean; consignDate?: string; deposit: number | null;
  date: string; lines: OrderLine[]; note: string; riskFlag?: string;
  /** 확정 입고예정일(YYYY-MM-DD). 있으면 PO 파생 ETA가 기본 리드타임 대신 이 날짜를 쓴다. */
  eta?: string | null;
  unit?: string | null; quoteTotal?: number | null; depositAmt?: number | null; quoteRef?: string | null;
  dev?: DevBrief;
  // 입고 → 카페24 재고 반영용 색상키워드 매핑. 입고 라인명(variant)이 key를 포함하면 해당 SKU에 +수량.
  cafe24Map?: Record<string, Cafe24Map>;
}
export interface ReceiptItem { variant: string; qty: number }
export interface Receipt {
  id: string; orderNo: string; at: string; items: ReceiptItem[];
  note?: string; cafe24Applied?: boolean;
}

// 입고 반영된 발주(라인별 누적입고·잔량 포함)
export interface OrderLineWithBalance extends OrderLine { received: number; remaining: number }
export interface OrderWithBalance extends Omit<PashoOrder, "lines"> {
  lines: OrderLineWithBalance[];
  orderedQty: number; receivedQty: number; remainingQty: number;
  receipts: Receipt[];
}

const K_ORDERS = "pasho:orders:v1";
const K_RECEIPTS = "pasho:receipts:v1";

function kv(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function kvGet<T>(key: string): Promise<T | null> {
  const sb = kv(); if (!sb) return null;
  const { data } = await sb.from("kv_store").select("data").eq("key", key).maybeSingle();
  return (data?.data as T) ?? null;
}
async function kvSet(key: string, data: unknown): Promise<void> {
  const sb = kv(); if (!sb) return;
  await sb.from("kv_store").upsert(
    { key, data, updated_at: new Date().toISOString() }, { onConflict: "key" },
  );
}

// ── 시드 (kv 비어있을 때 최초 1회 심음) ─────────────────────────
const SEED: PashoOrder[] = [
  {
    no: "P26-001", brand: "PV", model: "에끌라 오벌", code: "PVW-011", type: "리오더",
    status: "생산중", consign: false, deposit: null, date: "2026-06-28",
    unit: "$9.58", quoteTotal: 4790, depositAmt: null, quoteRef: "260415-3차 / 발주서 PO-20260415-01",
    lines: [{ variant: "골드", qty: 400 }, { variant: "블랙 다이얼", qty: 100 }],
    note: "기존 오벌(타원) 골드 리오더, 100개는 블랙 다이얼 변형. Y121 / 알루이 케이스.",
    cafe24Map: {
      "골드": { productNo: 195, variantCode: "P00000HN00CC", mall: "paulvice" },
      "실버": { productNo: 196, variantCode: "P00000HO000G", mall: "paulvice" },
    },
  },
  {
    no: "P26-002", brand: "PV", model: "옥타곤", code: "PVW-014", type: "신규양산",
    status: "컨펌", consign: false, deposit: 30, date: "2026-06-30",
    unit: "$14.53~15.61", quoteTotal: 15174, depositAmt: 4552, quoteRef: "260522-견적(PAULVICE)",
    lines: [{ variant: "골드 (400EA)", qty: 500 }, { variant: "실버 (600EA)", qty: 500 }],
    note: "VC10E / 3ATM / 가죽+PU 밴드. 선수금 30% $4,552 집행 완료. (견적 수량구성 400/600)",
  },
  {
    no: "P26-003", brand: "PV", model: "오드리 리메이크", code: "PVW-008-R", type: "리메이크",
    status: "생산중", consign: true, consignDate: "출고완료", deposit: null, date: "2026-07-03",
    lines: [{ variant: "분해 후 다이얼·바늘·밴드 재제작", qty: 620 }],
    note: "기존 완제품 620개 파쇼 반출. 사급 — 수량 대사 필수. 위탁가공비 견적 미수령.",
  },
  {
    no: "P26-004", brand: "PV", model: "10mm 메탈밴드 재도금", code: "PVS-band-10", type: "후가공",
    status: "생산중", consign: true, consignDate: "출고완료", deposit: null, date: "2026-07-01",
    lines: [{ variant: "옐로골드 재도금", qty: 200 }, { variant: "실버 재도금", qty: 150 }],
    note: "로즈골드 밴드 → 옐로/실버 재도금. 사급 350개. 재도금 단가 견적 미수령.",
  },
  {
    no: "D26-001", brand: "PV", model: "마고 (Margaux)", code: "PVW-015", type: "개발",
    status: "디자인", consign: false, deposit: null, date: "2026-07-02",
    lines: [{ variant: "양산 예정", qty: 1000 }],
    note: "아주 작은 직사각(쁘띠) 여성 워치. 디자인만 진행중 · 견적 미수령 · 발주 전.",
    dev: {
      concept: "쁘띠 직사각(탱크 실루엣) 여성 워치. 아주 작은 케이스로 미니멀·클래식 무드.",
      refs: "유사모델: 탱크 계열 소형 직사각 실루엣. (레퍼런스 이미지 별첨)",
      targetSpec: [
        { k: "케이스", v: "직사각 쁘띠 — 소형 (여성용, 폭 협의)" },
        { k: "무브먼트", v: "쿼츠 (VC10 / Y121 급, 협의)" },
        { k: "글라스", v: "미네랄 (커팅글라스 검토)" },
        { k: "밴드", v: "가죽 (색상 협의)" },
        { k: "도금", v: "골드 / 실버 (협의)" },
      ],
      sampleQty: "샘플 2~3점 (색상별)", prodQty: "양산 예정 1,000 EA",
      schedule: "디자인 확정 목표 · 샘플 납기 협의",
      reqNotes: "디자인 검토·수정 진행중. 확정 후 견적 요청 예정.",
    },
  },
  {
    no: "K26-001", brand: "KW", model: "기원 비취 (흑색 리메이크)", code: "KIW-JADE-R", type: "리메이크",
    status: "샘플", consign: false, deposit: null, date: "2026-07-05",
    lines: [{ variant: "비취 — 다이얼·밴드 신규 / 케이스·바늘·무브·버클 재활용", qty: 80 }],
    note: "기원 흑색 재고 80개를 비취색으로 리메이크. 다이얼·밴드 신규제작, 케이스·바늘·무브먼트·밴드버클 재활용. ⏳단가 파악중 · 밴드 제작가능여부 확인중(비취용 가죽밴드 1쌍 샘플 파쇼 전달). 확정되면 흑색 80개 사급출고.",
    cafe24Map: {
      "비취": { productNo: 122, variantCode: "P00000ES000A", mall: "harriot" },
    },
  },
  {
    no: "H26-001", brand: "HR", model: "설월 (雪月)", code: "HRW-007", type: "개발",
    status: "컨펌", consign: false, deposit: 30, date: "2026-07-03",
    riskFlag: "샘플 최종승인 전 선급 30% 집행",
    unit: "$43.70", quoteTotal: 17664, depositAmt: 5299, quoteRef: "260508-견적(harriot)",
    lines: [{ variant: "역방향 문페이즈 (고정 보름달·한옥 처마 컷아웃)", qty: 300 }],
    note: "RONDA 708 / Moon 디스크 3도인쇄. 양산 300개 발주 + 선급 30% $5,299 결제 완료.",
  },
  {
    no: "P26-005", brand: "PV", model: "브라운 가죽밴드", code: "PVS-band-BR", type: "신규양산",
    status: "생산중", consign: false, deposit: null, date: "2026-07-13",
    unit: null, quoteTotal: null, depositAmt: null, quoteRef: null,
    lines: [{ variant: "브라운 가죽밴드 (로즈골드 버클)", qty: 300 }],
    note: "허앤쉬 2차 공구(8/13~8/17) 증정용 — 에끌라 골드 전용 + 미니엘 색상선택. 시계 생산분에 추가 주문. 위탁가공비 견적 미수령.",
  },
];

export async function getOrders(): Promise<PashoOrder[]> {
  let orders = await kvGet<PashoOrder[]>(K_ORDERS);
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    await kvSet(K_ORDERS, SEED);
    orders = SEED;
  }
  return orders;
}

export async function getReceipts(): Promise<Receipt[]> {
  return (await kvGet<Receipt[]>(K_RECEIPTS)) ?? [];
}

/** 발주에 입고 누적·잔량을 합산해 반환 */
export async function getOrdersWithBalance(): Promise<OrderWithBalance[]> {
  const [orders, receipts] = await Promise.all([getOrders(), getReceipts()]);
  return orders.map((o) => withBalance(o, receipts.filter((r) => r.orderNo === o.no)));
}

export async function getOrderWithBalance(no: string): Promise<OrderWithBalance | null> {
  const [orders, receipts] = await Promise.all([getOrders(), getReceipts()]);
  const o = orders.find((x) => x.no === no);
  if (!o) return null;
  return withBalance(o, receipts.filter((r) => r.orderNo === no));
}

function withBalance(o: PashoOrder, rec: Receipt[]): OrderWithBalance {
  const recvByVariant = new Map<string, number>();
  for (const r of rec) for (const it of r.items) {
    recvByVariant.set(it.variant, (recvByVariant.get(it.variant) || 0) + it.qty);
  }
  const lines: OrderLineWithBalance[] = o.lines.map((l) => {
    const received = recvByVariant.get(l.variant) || 0;
    return { ...l, received, remaining: Math.max(0, l.qty - received) };
  });
  const orderedQty = o.lines.reduce((a, l) => a + l.qty, 0);
  const receivedQty = lines.reduce((a, l) => a + l.received, 0);
  return {
    ...o, lines, orderedQty, receivedQty,
    remainingQty: Math.max(0, orderedQty - receivedQty),
    receipts: rec.slice().sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/** 입고 기록 (색상별). id는 호출측이 시간기반으로 넘겨줌(스크립트 환경 Date 제약 회피). */
export async function addReceipt(rec: Omit<Receipt, "id"> & { id?: string }): Promise<Receipt> {
  const receipts = await getReceipts();
  const full: Receipt = {
    id: rec.id || `rcpt_${receipts.length + 1}_${rec.at}`,
    orderNo: rec.orderNo, at: rec.at, items: rec.items,
    note: rec.note, cafe24Applied: rec.cafe24Applied,
  };
  receipts.push(full);
  await kvSet(K_RECEIPTS, receipts);
  return full;
}
