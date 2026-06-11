/**
 * 부자재(택배박스·완충봉투·시계 배터리) 재고 — 완제품 재고와 별개 코너.
 * 저장: localStorage + Vercel KV (syncStorage, key=SUPPLIES_KEY). 완제품 inventoryStorage 와 동일 패턴.
 *
 * 소모 모델:
 *  - battery: 출고된 시계 모델에 매핑된 규격을 차감. 매핑에 없는 모델(에끌라·오드리·기원 = 최근입고·무교체)은 차감 안 함.
 *  - box/bag: 출고 1건/1개 규칙 기반 차감(면세점→면세점박스, 기원→기원박스, 그외→시계&주얼리박스, 봉투=시계 1개당 1장).
 * 자동 차감(Phase 2)은 baselineConsumed 스냅샷 이후 누적 출고분을 currentStock 에서 빼는 방식으로 붙인다.
 */
import { saveWithSync, loadFromServer } from "./syncStorage";

export type SupplyType = "box" | "bag" | "battery";

/** 배터리가 매핑된 시계 모델(출고 매칭용). brand+model 로 상품명 매칭 정밀도 확보. */
export interface SupplyModelRef {
  brand: string;   // 해리엇 | 폴바이스
  model: string;   // 성산 레이디 / 데비 ...
}

export interface SupplyItem {
  id: string;
  type: SupplyType;
  name: string;               // 표시명
  spec?: string;              // 배터리 규격 (SR626SW 등)
  models?: SupplyModelRef[];  // battery: 차감 대상 모델
  boxRule?: string;           // box/bag: 차감 규칙 키 (giwon | giwon2 | dutyfree | default | cushion)
  currentStock: number;
  reorderThreshold: number;   // 이 수량 이하면 발주 알림
  orderUrl?: string;          // 발주 링크
  unit?: string;              // 개 / 장 / EA
  notes?: string;
  // ── 자동 차감 스냅샷(Phase 2) ──
  autoDeduct?: boolean;       // 출고 연동 자동 차감 on/off
  baselineConsumed?: number;  // 마지막으로 currentStock 에 반영한 누적 출고량
  baselineAt?: string;        // 스냅샷 시각 ISO
}

export const SUPPLIES_KEY = "paulwise:supplies:v1";

const battery = (
  spec: string,
  models: SupplyModelRef[],
  currentStock: number,
): SupplyItem => ({
  id: `battery-${spec}`,
  type: "battery",
  name: `${spec} 배터리`,
  spec,
  models,
  currentStock,
  reorderThreshold: 5,
  unit: "개",
  autoDeduct: true,
});

const H = (model: string): SupplyModelRef => ({ brand: "해리엇", model });
const P = (model: string): SupplyModelRef => ({ brand: "폴바이스", model });

/** 이전 판매(단종) 모델 예비용 배터리 — 현재고만 추적, 출고 자동차감 없음. */
const spareBattery = (spec: string, currentStock: number): SupplyItem => ({
  id: `battery-${spec}`,
  type: "battery",
  name: `${spec} 배터리`,
  spec,
  models: [],
  currentStock,
  reorderThreshold: 5,
  unit: "개",
  autoDeduct: false,
  notes: "단종 모델 예비용 — 자동차감 없음",
});

/** 사장님 제공 매핑(2026-06-11). 에끌라·오드리·기원은 무교체라 미포함. */
export const DEFAULT_SUPPLIES: SupplyItem[] = [
  // ── 택배박스 4종 ──
  { id: "box-default", type: "box", name: "시계&주얼리 박스", boxRule: "default", currentStock: 228, reorderThreshold: 20, unit: "개", autoDeduct: true, notes: "기원·면세점 외 기본 박스" },
  { id: "box-giwon", type: "box", name: "기원시계 박스", boxRule: "giwon", currentStock: 27, reorderThreshold: 10, unit: "개", autoDeduct: true },
  { id: "box-giwon2", type: "box", name: "기원시계 2개용 박스", boxRule: "giwon2", currentStock: 39, reorderThreshold: 10, unit: "개", autoDeduct: true, notes: "한 주문에 기원 2개" },
  { id: "box-dutyfree", type: "box", name: "면세점 납품 박스", boxRule: "dutyfree", currentStock: 0, reorderThreshold: 10, unit: "개", autoDeduct: true },
  // ── 완충봉투 ──
  { id: "bag-cushion", type: "bag", name: "시계포장용 완충제 봉투", boxRule: "cushion", currentStock: 246, reorderThreshold: 30, unit: "장", autoDeduct: true, notes: "시계 출고 1개당 1장" },
  // ── 배터리(규격별) ──
  battery("SR920SW", [H("성산 레이디"), H("서해"), H("일구")], 8),
  battery("SR626SW", [H("광안 레이디"), P("데비"), P("미니엘"), P("켈리"), P("엠마")], 2),
  battery("SR621SW", [H("가양"), P("로지")], 6),
  battery("SR927SW", [H("성산")], 9),
  battery("SR721SW", [H("일구 레이디")], 12),
  battery("SR521SW", [P("미니엘 쁘띠"), P("세이렌")], 50),
  // ── 단종 모델 예비용(현재고만, 자동차감 없음) ──
  spareBattery("SR936SW", 9),
  spareBattery("SR731SW", 7),
  spareBattery("SR616SW", 14),
  spareBattery("SR916SW", 3),
];

/** 저장된 부자재 로드. 없으면 기본 시드. 신규 기본항목은 병합(기존 수량 보존). */
export async function loadSupplies(): Promise<SupplyItem[]> {
  let stored: SupplyItem[] | null = null;
  try {
    stored = await loadFromServer<SupplyItem[]>(SUPPLIES_KEY);
    if (!stored && typeof window !== "undefined") {
      const raw = localStorage.getItem(SUPPLIES_KEY);
      if (raw) stored = JSON.parse(raw) as SupplyItem[];
    }
  } catch {
    stored = null;
  }
  if (!stored || !stored.length) return DEFAULT_SUPPLIES.map((s) => ({ ...s }));
  // 기본 시드 중 저장본에 없는 신규 항목만 추가(매핑 갱신은 코드 시드 우선, 수량/링크는 저장본 보존)
  const byId = new Map(stored.map((s) => [s.id, s]));
  const merged = DEFAULT_SUPPLIES.map((def) => {
    const cur = byId.get(def.id);
    return cur
      ? { ...def, currentStock: cur.currentStock, reorderThreshold: cur.reorderThreshold, orderUrl: cur.orderUrl ?? def.orderUrl, baselineConsumed: cur.baselineConsumed, baselineAt: cur.baselineAt, autoDeduct: cur.autoDeduct ?? def.autoDeduct, notes: cur.notes ?? def.notes }
      : { ...def };
  });
  // 저장본에만 있는 사용자 추가 항목 보존
  for (const s of stored) if (!DEFAULT_SUPPLIES.some((d) => d.id === s.id)) merged.push(s);
  return merged;
}

export function saveSupplies(items: SupplyItem[]): void {
  saveWithSync(SUPPLIES_KEY, items);
}
