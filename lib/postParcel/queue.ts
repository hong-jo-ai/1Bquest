/**
 * 우체국 접수 큐 (Supabase kv_store 기반).
 *
 * 접수는 보안키(SEED)+계약 IP 때문에 iMac 로컬에서만 가능 → 배포(Vercel) 서버는 로컬
 * 에이전트(127.0.0.1:7777)에 닿지 못한다. 그래서 배포 사이트는 "접수 요청"을 큐에 적재만 하고,
 * iMac 의 경량 워커(registerQueueWorker.js)가 폴링해 실제 접수 후 결과를 같은 row 에 기록한다.
 * (에이전트를 외부에 노출하지 않음 — 아웃바운드 폴링만.)
 *
 * job key = pp_register_job:<uuid>, data = PpRegisterJob.
 */
import { createClient } from "@supabase/supabase-js";

export type PpJobKind = "one" | "batch" | "outbound" | "return";
export type PpJobStatus = "pending" | "processing" | "done" | "error";

export interface PpRegisterJob {
  id: string;
  kind: PpJobKind;
  payload: unknown;
  status: PpJobStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const PREFIX = "pp_register_job:";

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** 접수 요청 적재 → jobId 반환. */
export async function enqueueJob(kind: PpJobKind, payload: unknown): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();
  const job: PpRegisterJob = {
    id, kind, payload, status: "pending", result: null, error: null, createdAt: now, updatedAt: now,
  };
  const { error } = await sb()
    .from("kv_store")
    .upsert({ key: PREFIX + id, data: job, updated_at: now }, { onConflict: "key" });
  if (error) throw new Error(`접수 큐 적재 실패: ${error.message}`);
  return id;
}

/** jobId 로 현재 상태/결과 조회 (없으면 null). */
export async function getJob(id: string): Promise<PpRegisterJob | null> {
  const { data } = await sb().from("kv_store").select("data").eq("key", PREFIX + id).maybeSingle();
  return (data?.data as PpRegisterJob) ?? null;
}
