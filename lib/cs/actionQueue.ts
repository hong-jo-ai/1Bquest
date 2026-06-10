/**
 * CS 액션 큐 (Supabase kv_store). 식스샵 등 마켓 CS 처리(문의 답변·반품 수락/회수도착)는
 * 브라우저 자동화가 필요해 iMac 에서만 가능 → 배포(Vercel) 서버는 잡을 적재만 하고,
 * 브라우저 워커(local-agent/csActionWorker.js)가 폴링해 실제 액션 후 결과를 같은 row 에 기록한다.
 * (우체국 register 큐와 별개 — 그쪽은 무브라우저 우체국 API 전용.)
 *
 * job key = cs_action_job:<uuid>
 */
import { createClient } from "@supabase/supabase-js";

export type CsActionKind =
  | "sixshop_reply"    // 식스샵 문의 게시판 댓글 답변
  | "sixshop_claim"    // 식스샵 반품/교환/취소 클레임 처리(주문목록 체크박스→툴바 버튼)
  | "wconcept_claim";  // W컨셉 반품 회수완료(교환/반품 접수내역 체크→회수완료)

export type CsActionStatus = "pending" | "processing" | "done" | "error";

export interface CsActionJob {
  id: string;
  kind: CsActionKind;
  payload: unknown;
  status: CsActionStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const PREFIX = "cs_action_job:";

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function enqueueCsAction(kind: CsActionKind, payload: unknown): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();
  const job: CsActionJob = { id, kind, payload, status: "pending", result: null, error: null, createdAt: now, updatedAt: now };
  const { error } = await sb().from("kv_store").upsert({ key: PREFIX + id, data: job, updated_at: now }, { onConflict: "key" });
  if (error) throw new Error(`CS 액션 큐 적재 실패: ${error.message}`);
  return id;
}

export async function getCsAction(id: string): Promise<CsActionJob | null> {
  const { data } = await sb().from("kv_store").select("data").eq("key", PREFIX + id).maybeSingle();
  return (data?.data as CsActionJob) ?? null;
}

/** 잡이 done/error 가 될 때까지 폴링 (서버 라우트에서 동기 대기용). 타임아웃 시 마지막 상태 반환. */
export async function waitCsAction(id: string, timeoutMs = 50000, intervalMs = 2000): Promise<CsActionJob | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await getCsAction(id);
    if (job && (job.status === "done" || job.status === "error")) return job;
    if (Date.now() >= deadline) return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
