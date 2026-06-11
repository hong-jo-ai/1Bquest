/**
 * 식스샵 반품/교환/취소 클레임 → CS 인박스(cs_threads item_type='return' + cs_returns).
 * 소스는 식스샵 국내 export 의 '주문 상태' 컬럼(반품 요청/반품 수거 중/완료 등) — 로컬 에이전트가 파싱해 전달.
 * 멱등: (channel, order_number, claim_type) 유니크로 upsert. 라이프사이클 상태는 매 동기화로 갱신.
 */
import { getCsSupabase } from "./store";
import {
  CLAIM_TYPE_LABEL,
  RETURN_STATUS_LABEL,
  type CsBrandId,
  type CsClaimType,
  type CsReturnStatus,
  type CsStatus,
} from "./types";

// 반품 라이프사이클 → 인박스 스레드 상태(탭/알람).
//  requested(우체국 회수 접수 필요)·received(반품완료 처리 필요) = unanswered(미답변·알람)
//  in_transit(회수 중)·confirmed(수락) = waiting(대기중 — 알람 끔, 택배 도착 대기)
//  done·rejected = resolved
export function threadStatusForReturn(status: string): CsStatus {
  if (status === "done" || status === "rejected") return "resolved";
  if (status === "in_transit" || status === "confirmed") return "waiting";
  return "unanswered";
}

export interface SixshopClaimInput {
  brand?: CsBrandId;          // 기본 paulvice (상품이 폴바이스)
  channel?: "sixshop" | "wconcept" | "musinsa"; // 마켓 채널 (기본 sixshop)
  orderNumber: string;
  claimType: CsClaimType;     // return | exchange | cancel
  status: CsReturnStatus;
  product?: string;
  reason?: string;
  customerName?: string;
  recoveryTrackingNo?: string;
  requestedAt?: string;       // ISO; 없으면 now
  raw?: unknown;
}

/** 클레임 1건 upsert → { threadId, inserted, skipped }. 식스샵/W컨셉 공용(channel). */
export async function upsertSixshopClaim(
  c: SixshopClaimInput,
): Promise<{ threadId: string | null; inserted: boolean; skipped?: boolean }> {
  const db = getCsSupabase();
  const channel = c.channel ?? "sixshop";
  const brand: CsBrandId = c.brand ?? "paulvice";
  const externalThreadId = `return:${c.orderNumber}:${c.claimType}`;
  const at = c.requestedAt ?? new Date().toISOString();
  const subject = `[${CLAIM_TYPE_LABEL[c.claimType]}] ${c.product ?? c.orderNumber}`;
  const previewText = `${CLAIM_TYPE_LABEL[c.claimType]} · ${RETURN_STATUS_LABEL[c.status]}`;
  const threadStatus = threadStatusForReturn(c.status);

  const { data: existing } = await db
    .from("cs_threads")
    .select("id, status")
    .eq("channel", channel)
    .eq("external_thread_id", externalThreadId)
    .maybeSingle();

  // 과거 이력(취소완료 등) 무더기 유입 방지: 완료/거부 클레임은 이미 추적 중일 때만 갱신, 신규 생성 안 함.
  if (!existing && (c.status === "done" || c.status === "rejected")) {
    return { threadId: null, inserted: false, skipped: true };
  }

  let threadId: string;
  if (existing) {
    threadId = existing.id;
    await db
      .from("cs_threads")
      .update({
        last_message_at: at,
        last_message_preview: previewText,
        subject,
        ...(c.customerName ? { customer_name: c.customerName } : {}),
        // 사용자가 보관(archived) 한 건은 보존, 그 외엔 라이프사이클 반영
        status: existing.status === "archived" ? "archived" : threadStatus,
      })
      .eq("id", threadId);
  } else {
    const { data: ins, error } = await db
      .from("cs_threads")
      .insert({
        brand,
        channel,
        external_thread_id: externalThreadId,
        customer_name: c.customerName ?? null,
        subject,
        last_message_at: at,
        last_message_preview: previewText,
        status: threadStatus,
        item_type: "return",
      })
      .select("id")
      .single();
    if (error || !ins) throw new Error(`cs_threads(return) insert 실패: ${error?.message}`);
    threadId = ins.id;
  }

  const { error: rErr } = await db.from("cs_returns").upsert(
    {
      thread_id: threadId,
      channel,
      order_number: c.orderNumber,
      claim_type: c.claimType,
      product: c.product ?? null,
      reason: c.reason ?? null,
      customer_name: c.customerName ?? null,
      recovery_tracking_no: c.recoveryTrackingNo ?? null,
      status: c.status,
      raw: c.raw ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel,order_number,claim_type" },
  );
  if (rErr) throw new Error(`cs_returns upsert 실패: ${rErr.message}`);

  return { threadId, inserted: !existing };
}

/** 스레드의 반품 클레임 조회 (상세에서 액션버튼 렌더용). */
export async function getReturnByThread(threadId: string): Promise<import("./types").CsReturn | null> {
  const db = getCsSupabase();
  const { data } = await db.from("cs_returns").select("*").eq("thread_id", threadId).maybeSingle();
  return (data as import("./types").CsReturn) ?? null;
}

/** 클레임 처리 후 라이프사이클 상태 갱신 + 스레드 상태 동기화([[threadStatusForReturn]]).
 *  extra 로 cs_returns 추가 컬럼(회수송장 등) 동시 갱신. */
export async function setReturnStatus(
  threadId: string,
  status: import("./types").CsReturnStatus,
  extra?: { recoveryTrackingNo?: string },
): Promise<void> {
  const db = getCsSupabase();
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (extra?.recoveryTrackingNo) patch.recovery_tracking_no = extra.recoveryTrackingNo;
  await db.from("cs_returns").update(patch).eq("thread_id", threadId);
  await db.from("cs_threads").update({ status: threadStatusForReturn(status) }).eq("id", threadId);
}
