/**
 * 고객 약속(promise) — "이 주문 보낼 때 쇼핑백 3개 넣기" 같은 구두 약속을 붙잡아 둔다.
 *
 * 문제: 상담에서 한 약속은 대화 안에만 남고, 정작 실행 시점(포장·출고)에는 아무 데도 안 뜬다.
 *       그래서 새 제품만 나가고 약속이 조용히 깨진다(2026-08-28 무신사 김수현 쇼핑백 건).
 *
 * 그래서 저장 축이 셋이다 — 어느 쪽에서 들어와도 같은 약속에 닿아야 한다:
 *   ① thread_id  → CS 인박스에서 그 고객 대화를 열 때
 *   ② seller|order → 우체국 출고 목록·발송 화면에서 그 주문이 나올 때
 *   ③ remind_on  → 그날 아침 텔레그램으로
 *
 * ⚠️ 저장소는 일부러 kv_store 다(테이블 아님). supabase/migrations 는 사람이 SQL Editor 에서
 *    직접 실행하는 규약이라, 테이블로 만들면 그 수동 실행 전까지 기능이 통째로 죽는다.
 *    건수도 적고(월 몇 건), local-agent(node)에서 읽는 방식도 pp_hold_orders 와 똑같아진다.
 */
import { getCsSupabase } from "./store";

export const CS_PROMISES_KEY = "cs_promises";

export type CsPromise = {
  id: string;
  /** 약속 내용 한 줄 — 실행하는 사람이 그대로 읽고 행동할 수 있게 쓴다. */
  text: string;
  /** 텔레그램으로 상기시킬 날짜 (YYYY-MM-DD, KST). 없으면 알림 안 감. */
  remindOn?: string | null;
  /** 늦어도 이날까지는 끝나야 함 (YYYY-MM-DD, KST). 표시·정렬용. */
  dueOn?: string | null;
  /** 출고 화면 매칭용. 판매처는 pp_shipments.channel / 출고행 seller 와 같은 표기. */
  orderNumber?: string | null;
  seller?: string | null;
  threadId?: string | null;
  customerName?: string | null;
  customerHandle?: string | null;
  status: "open" | "done";
  createdAt: string;
  doneAt?: string | null;
  /** 마지막으로 텔레그램 알림을 보낸 날(YYYY-MM-DD) — 하루 1회 가드. */
  lastNotifiedOn?: string | null;
};

type Store = { items: CsPromise[]; updatedAt?: string };

export function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** 출고행/입고행과 맞추는 매칭 키. 주문번호만으로도 맞도록 판매처는 선택적으로 쓴다. */
export function promiseOrderKey(seller: string | null | undefined, order: string): string {
  return `${(seller ?? "").trim()}|${order.trim()}`;
}

async function readStore(): Promise<Store> {
  const db = getCsSupabase();
  const { data } = await db.from("kv_store").select("data").eq("key", CS_PROMISES_KEY).maybeSingle();
  const raw = data?.data as Partial<Store> | undefined;
  if (!raw || !Array.isArray(raw.items)) return { items: [] };
  return { items: raw.items.filter(isPromise), updatedAt: raw.updatedAt };
}

function isPromise(v: unknown): v is CsPromise {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<CsPromise>;
  return typeof p.id === "string" && typeof p.text === "string";
}

async function writeStore(items: CsPromise[]): Promise<void> {
  const db = getCsSupabase();
  const now = new Date().toISOString();
  const { error } = await db
    .from("kv_store")
    .upsert({ key: CS_PROMISES_KEY, data: { items, updatedAt: now }, updated_at: now }, { onConflict: "key" });
  if (error) throw new Error(`약속 저장 실패: ${error.message}`);
}

export async function listPromises(opts: { includeDone?: boolean } = {}): Promise<CsPromise[]> {
  const { items } = await readStore();
  const rows = opts.includeDone ? items : items.filter((p) => p.status !== "done");
  // 마감 임박 우선 — 날짜 없는 건 뒤로.
  return rows.sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
}

export async function listPromisesByThread(threadId: string): Promise<CsPromise[]> {
  const { items } = await readStore();
  return items.filter((p) => p.threadId === threadId);
}

/**
 * 출고 화면용 — 주문번호 → 미완료 약속. 판매처 표기가 화면마다 달라서(카페24/cafe24 등)
 * 주문번호만으로도 찾히게 한다. 놓치는 것보다 조금 넓게 잡는 편이 낫다.
 */
export async function promisesByOrder(): Promise<Map<string, CsPromise[]>> {
  const { items } = await readStore();
  const map = new Map<string, CsPromise[]>();
  for (const p of items) {
    if (p.status === "done" || !p.orderNumber) continue;
    const key = p.orderNumber.trim();
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), p]);
  }
  return map;
}

export async function createPromise(input: {
  text: string;
  remindOn?: string | null;
  dueOn?: string | null;
  orderNumber?: string | null;
  seller?: string | null;
  threadId?: string | null;
  customerName?: string | null;
  customerHandle?: string | null;
}): Promise<CsPromise> {
  const text = input.text.trim();
  if (!text) throw new Error("약속 내용이 비어 있습니다");

  const promise: CsPromise = {
    id: crypto.randomUUID(),
    text: text.slice(0, 500),
    remindOn: normalizeDate(input.remindOn),
    dueOn: normalizeDate(input.dueOn),
    orderNumber: trimOrNull(input.orderNumber, 60),
    seller: trimOrNull(input.seller, 40),
    threadId: trimOrNull(input.threadId, 60),
    customerName: trimOrNull(input.customerName, 60),
    customerHandle: trimOrNull(input.customerHandle, 60),
    status: "open",
    createdAt: new Date().toISOString(),
  };

  const { items } = await readStore();
  await writeStore([promise, ...items]);
  return promise;
}

export async function setPromiseStatus(id: string, status: "open" | "done"): Promise<CsPromise | null> {
  const { items } = await readStore();
  let hit: CsPromise | null = null;
  const next = items.map((p) => {
    if (p.id !== id) return p;
    hit = { ...p, status, doneAt: status === "done" ? new Date().toISOString() : null };
    return hit;
  });
  if (!hit) return null;
  await writeStore(next);
  return hit;
}

export async function deletePromise(id: string): Promise<boolean> {
  const { items } = await readStore();
  const next = items.filter((p) => p.id !== id);
  if (next.length === items.length) return false;
  await writeStore(next);
  return true;
}

/** 오늘 알릴 약속 — remindOn 이 오늘이거나 이미 지났고, 아직 오늘 안 보낸 것. */
export async function dueForReminder(today = todayKst()): Promise<CsPromise[]> {
  const { items } = await readStore();
  return items.filter(
    (p) =>
      p.status !== "done" &&
      p.remindOn != null &&
      p.remindOn <= today &&
      p.lastNotifiedOn !== today
  );
}

export async function markNotified(ids: string[], today = todayKst()): Promise<void> {
  if (!ids.length) return;
  const set = new Set(ids);
  const { items } = await readStore();
  await writeStore(items.map((p) => (set.has(p.id) ? { ...p, lastNotifiedOn: today } : p)));
}

function normalizeDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}
