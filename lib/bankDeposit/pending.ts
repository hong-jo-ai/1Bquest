/**
 * 미매칭 입금 재시도 큐.
 *
 * 입금 SMS가 주문 등록보다 먼저 도착하면(타이밍 역전) 최초 매칭이 0건이 된다.
 * 이때 SMS를 버리지 않고 이 큐에 적재 → bank-deposit-retry 크론이 주기적으로
 * 재매칭한다. RETRY_WINDOW_MS 안에 주문이 들어오면 자동 입금확인, 지나면 포기(수동).
 *
 * 저장소: kv_store, key = `${PENDING_PREFIX}${hash}`.
 */
import { getCsSupabase } from "@/lib/cs/store";
import { type ParsedDeposit } from "./parser";

const PENDING_PREFIX = "bank_deposit_pending:";

/** 재시도 윈도우 — 이 시간 지나도 주문 안 잡히면 포기하고 수동 알림. */
export const RETRY_WINDOW_MS = 30 * 60 * 1000;

export interface PendingDeposit {
  hash:        string;
  parsed:      ParsedDeposit;
  firstSeen:   string; // ISO — 최초 적재 시각(윈도우 기준)
  attempts:    number;
  lastAttempt: string; // ISO
}

export async function enqueuePending(hash: string, parsed: ParsedDeposit): Promise<void> {
  const db = getCsSupabase();
  const now = new Date().toISOString();
  const rec: PendingDeposit = { hash, parsed, firstSeen: now, attempts: 0, lastAttempt: now };
  await db.from("kv_store").upsert(
    { key: `${PENDING_PREFIX}${hash}`, data: rec as unknown as object, updated_at: now },
    { onConflict: "key" },
  );
}

export async function listPending(): Promise<PendingDeposit[]> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .like("key", `${PENDING_PREFIX}%`);
  return ((data ?? []).map((r) => r.data as PendingDeposit)).filter((p) => p && p.hash);
}

/** 재시도했으나 아직 미매칭 — 카운트만 올려 큐에 유지. */
export async function bumpPendingAttempt(rec: PendingDeposit): Promise<void> {
  const db = getCsSupabase();
  const now = new Date().toISOString();
  const next: PendingDeposit = { ...rec, attempts: rec.attempts + 1, lastAttempt: now };
  await db.from("kv_store").upsert(
    { key: `${PENDING_PREFIX}${rec.hash}`, data: next as unknown as object, updated_at: now },
    { onConflict: "key" },
  );
}

export async function removePending(hash: string): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").delete().eq("key", `${PENDING_PREFIX}${hash}`);
}
