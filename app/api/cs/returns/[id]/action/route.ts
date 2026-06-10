/**
 * 식스샵 반품/교환/취소 클레임 처리 — 인박스 반품 카드의 액션 버튼.
 * POST { action: 'received' | 'complete' | 'reject' }
 *   action → 식스샵 주문목록 툴바 버튼 텍스트 매핑(클레임 종류별) → 큐 적재 → 워커가 처리 → cs_returns 상태 갱신.
 * 브라우저 액션이라 iMac 워커(csActionWorker) 경유. done 까지 폴링(maxDuration 60).
 */
import { type NextRequest } from "next/server";
import { enqueueCsAction, waitCsAction } from "@/lib/cs/actionQueue";
import { getReturnByThread, setReturnStatus } from "@/lib/cs/sixshopIngest";
import type { CsClaimType, CsReturnStatus } from "@/lib/cs/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 액션 → (클레임종류별 식스샵 버튼텍스트, 처리 후 상태)
function resolveButton(action: string, claim: CsClaimType): { buttonText: string; next: CsReturnStatus } | null {
  if (action === "received") return { buttonText: "수거 완료 처리", next: "received" };
  if (action === "complete") {
    const bt = claim === "return" ? "반품 완료 처리" : claim === "exchange" ? "교환 재배송 처리" : "취소 완료 처리";
    return { buttonText: bt, next: "done" };
  }
  if (action === "reject") {
    const bt = claim === "return" ? "반품 거부 처리" : claim === "exchange" ? "교환 거부 처리" : "취소 거부 처리";
    return { buttonText: bt, next: "rejected" };
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const ret = await getReturnByThread(id);
  if (!ret) return Response.json({ error: "반품 정보 없음" }, { status: 404 });
  const map = resolveButton(action || "", ret.claim_type);
  if (!map) return Response.json({ error: `알 수 없는 action: ${action}` }, { status: 400 });

  try {
    const jobId = await enqueueCsAction("sixshop_claim", { orderNumber: ret.order_number, buttonText: map.buttonText });
    const job = await waitCsAction(jobId);
    if (!job || job.status !== "done") {
      return Response.json({ ok: false, error: job?.error || "처리 시간초과 — 잠시 후 확인" }, { status: 502 });
    }
    await setReturnStatus(id, map.next);
    return Response.json({ ok: true, status: map.next });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
