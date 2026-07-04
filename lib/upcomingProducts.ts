/**
 * 신제품 입고 로드맵 — 아직 출시 전인 신상의 샘플·입고 일정을 추적.
 *
 * 발주(PO)와 별개: PO는 기존 SKU에 발주일+리드타임으로 재입고를 잡지만,
 * 신상은 SKU가 없고 "샘플 출고 → 제품 입고" 같은 마일스톤으로 진행된다.
 * 저장: kv_store.upcoming_products (배열).
 */
import { createClient } from "@supabase/supabase-js";
import { pashoToUpcoming, mergeDedup } from "@/lib/pasho/derive";

const KEY = "upcoming_products";

export type UpcomingStatus = "tracking" | "arrived" | "cancelled";

export interface Milestone {
  label: string;        // "샘플 출고", "제품 입고" 등
  date: string;         // YYYY-MM-DD (목표/예상, KST)
  note?: string | null; // "7월말 목표" 등 원문 뉘앙스 보존
  done?: boolean;
}

export interface UpcomingProduct {
  id: string;
  brand: string;            // "해리엇" | "폴바이스" 등
  name: string;             // "설월 시계", "옥타곤 모델"
  category?: string | null; // "시계" 등 (선택)
  milestones: Milestone[];
  status: UpcomingStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  derived?: boolean; // 파쇼 발주에서 파생(읽기전용) — 수정은 /pasho 에서
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** kv 원본(수동입력분)만 — 쓰기 함수는 반드시 이걸 써야 파생분이 kv에 새지 않는다. */
async function loadRaw(): Promise<UpcomingProduct[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from("kv_store").select("data").eq("key", KEY).maybeSingle();
  const arr = data?.data;
  return Array.isArray(arr) ? (arr as UpcomingProduct[]) : [];
}

/** 소비용(성장레버·MORI·API·UI) — 수동분 + 파쇼 파생, 모델명 중복 제거(파쇼 우선). */
export async function listUpcomingProducts(): Promise<UpcomingProduct[]> {
  const [manual, derived] = await Promise.all([loadRaw(), pashoToUpcoming().catch(() => [])]);
  return mergeDedup(manual, derived);
}

async function saveAll(list: UpcomingProduct[]): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const { error } = await db
    .from("kv_store")
    .upsert({ key: KEY, data: list, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

function newId(): string {
  return `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function normMilestones(input: unknown): Milestone[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m) => {
      const o = m as Partial<Milestone>;
      return {
        label: (o.label ?? "").toString().trim(),
        date: (o.date ?? "").toString().trim(),
        note: o.note ?? null,
        done: !!o.done,
      };
    })
    .filter((m) => m.label && m.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface UpsertInput {
  brand: string;
  name: string;
  category?: string | null;
  milestones?: Milestone[];
  status?: UpcomingStatus;
  notes?: string | null;
}

export async function createUpcomingProduct(input: UpsertInput): Promise<UpcomingProduct> {
  const now = new Date().toISOString();
  const item: UpcomingProduct = {
    id: newId(),
    brand: input.brand.trim(),
    name: input.name.trim(),
    category: input.category?.trim() || null,
    milestones: normMilestones(input.milestones),
    status: input.status ?? "tracking",
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const list = await loadRaw();
  list.push(item);
  await saveAll(list);
  return item;
}

export async function updateUpcomingProduct(
  id: string,
  patch: Partial<Omit<UpcomingProduct, "id" | "createdAt">>,
): Promise<UpcomingProduct | null> {
  const list = await loadRaw();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const next = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  if (patch.milestones) next.milestones = normMilestones(patch.milestones);
  list[idx] = next;
  await saveAll(list);
  return list[idx];
}

export async function deleteUpcomingProduct(id: string): Promise<boolean> {
  const list = await loadRaw();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  await saveAll(next);
  return true;
}
