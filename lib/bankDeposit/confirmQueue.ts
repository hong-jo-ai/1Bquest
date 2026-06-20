/**
 * 카페24 무통장 입금확인 — 브라우저 실행 큐.
 *
 * API 입금확인(process_status:prepare)은 422로 막혀(무통장은 입금확인→상품준비중 2단계),
 * 실제 '입금확인' 버튼 클릭은 iMac의 cafe24DepositConfirm.js(Playwright)만 가능하다.
 * 서버(webhook·retry 크론)는 HIGH 매칭 시 이 큐에 적재만 하고, iMac 입금확인 워처가
 * 폴링하여 브라우저로 처리한다. (postParcel register-queue 와 동형)
 *
 * 저장소: kv_store, key = `${PREFIX}${orderId}`.
 */
import { getCsSupabase } from "@/lib/cs/store";

const PREFIX = "bank_deposit_confirm:";

export interface ConfirmJob {
  orderId:  string;
  mall:     string;   // "paulvice" | "harriot"
  amount:   number;
  name:     string | null;
  queuedAt: string;   // ISO
  attempts: number;
}

/** HIGH 매칭 주문을 입금확인 큐에 적재(멱등 — 같은 주문 재적재는 덮어씀). */
export async function enqueueConfirm(orderId: string, mall: string, amount: number, name: string | null): Promise<void> {
  const db = getCsSupabase();
  const now = new Date().toISOString();
  const rec: ConfirmJob = { orderId, mall, amount, name, queuedAt: now, attempts: 0 };
  await db.from("kv_store").upsert(
    { key: `${PREFIX}${orderId}`, data: rec as unknown as object, updated_at: now },
    { onConflict: "key" },
  );
}

/** 대기 중인 입금확인 잡 목록. */
export async function listConfirmJobs(): Promise<ConfirmJob[]> {
  const db = getCsSupabase();
  const { data } = await db.from("kv_store").select("data").like("key", `${PREFIX}%`);
  return ((data ?? []) as Array<{ data: ConfirmJob }>).map((r) => r.data).filter((d) => d && d.orderId);
}

/** 처리 완료/포기 — 큐에서 제거. */
export async function removeConfirm(orderId: string): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").delete().eq("key", `${PREFIX}${orderId}`);
}

/** 시도 횟수 증가(실패 후 재시도 추적용). */
export async function bumpConfirm(job: ConfirmJob): Promise<void> {
  const db = getCsSupabase();
  const now = new Date().toISOString();
  const rec: ConfirmJob = { ...job, attempts: (job.attempts ?? 0) + 1 };
  await db.from("kv_store").upsert(
    { key: `${PREFIX}${job.orderId}`, data: rec as unknown as object, updated_at: now },
    { onConflict: "key" },
  );
}
