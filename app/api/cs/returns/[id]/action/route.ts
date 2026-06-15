/**
 * 식스샵 반품/교환/취소 클레임 처리 — 인박스 반품 카드의 액션 버튼.
 * POST { action: 'pickup' | 'received' | 'complete' | 'reject' }
 *   - pickup: 우체국 반품 회수 접수(출고 수령주소를 회수지로) → in_transit(대기중). 우체국 큐 워커 경유.
 *   - received|complete|reject: 식스샵 주문목록 툴바 버튼 매핑 → cs_action 큐 → 브라우저 워커(csActionWorker).
 * done 까지 폴링(maxDuration 60).
 */
import { type NextRequest } from "next/server";
import { enqueueCsAction, waitCsAction } from "@/lib/cs/actionQueue";
import { getReturnByThread, setReturnStatus } from "@/lib/cs/sixshopIngest";
import { getCsSupabase } from "@/lib/cs/store";
import { enqueueJob, getJob } from "@/lib/postParcel/queue";
import { CHANNEL_LABEL, type CsClaimType, type CsReturnStatus, type CsReturn } from "@/lib/cs/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** 우체국 반품 회수 접수 — 출고 수령주소(pp_shipments)를 회수지로 큐 적재 → 워커 → in_transit(대기중).
 *  우체국 API 는 한국 IP·보안키가 필요해 iMac register-queue 워커가 실행. 서버측 폴링으로 결과 대기. */
async function handlePickup(threadId: string, ret: CsReturn) {
  const db = getCsSupabase();
  const channelLabel = CHANNEL_LABEL[ret.channel] ?? ret.channel; // sixshop→식스샵
  const { data: pp } = await db
    .from("pp_shipments")
    .select("recipient_name,recipient_addr,recipient_zip,recipient_mobile,recipient_tel,regi_no")
    .eq("order_number", ret.order_number)
    .eq("channel", channelLabel)
    .eq("req_type", "1")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pp || !pp.recipient_addr || !pp.recipient_zip) {
    return Response.json({ ok: false, error: "회수 주소를 찾을 수 없습니다(출고 기록 없음) — 수동 접수 필요" }, { status: 422 });
  }
  const jobId = await enqueueJob("return", {
    order: ret.order_number,
    seller: channelLabel,
    name: pp.recipient_name || ret.customer_name || "",
    addr: pp.recipient_addr,
    zip: pp.recipient_zip,
    mobile: pp.recipient_mobile || "",
    tel: pp.recipient_tel || "",
    prod: ret.product || "",
    retOrigRegiNo: pp.regi_no || "",
  });
  let job = null;
  for (let i = 0; i < 25; i++) {
    await sleep(2000);
    job = await getJob(jobId);
    if (job && (job.status === "done" || job.status === "error")) break;
  }
  if (!job || job.status !== "done") {
    return Response.json({ ok: false, error: job?.error || "우체국 접수 시간초과 — 잠시 후 다시 시도" }, { status: 502 });
  }
  const regiNo = (job.result as { regiNo?: string } | null)?.regiNo || "";
  const isReal = !!regiNo && regiNo !== "TESTREGINOAPI";
  await setReturnStatus(threadId, "in_transit", isReal ? { recoveryTrackingNo: regiNo } : undefined);
  return Response.json({
    ok: true,
    status: "in_transit",
    regiNo,
    message: isReal ? `우체국 회수 접수 완료 — 회수송장 ${regiNo} · 대기중으로 이동` : "우체국 회수 접수(테스트) · 대기중으로 이동",
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const ret = await getReturnByThread(id);
  if (!ret) return Response.json({ error: "반품 정보 없음" }, { status: 404 });

  // AS 접수 후 대기중 전환 — W컨셉 회수는 자동(계약택배)이므로 큐/워커 없이
  // 클레임만 회수중(in_transit=대기중)으로 올려 미답변에서 빼고 택배 도착을 기다린다.
  // setReturnStatus 가 nonRegressing 으로 보존돼 재동기화에도 대기중 유지.
  if (action === "waiting") {
    await setReturnStatus(id, "in_transit");
    return Response.json({ ok: true, status: "in_transit", message: "대기중으로 이동 — 택배 도착 후 회수 완료를 누르세요" });
  }

  // 우체국 반품 회수 접수(대기중으로) — 브라우저 워커 아님, 우체국 큐 경유.
  if (action === "pickup") {
    try {
      return await handlePickup(id, ret);
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  // 채널별 잡 종류/버튼 매핑. W컨셉 반품은 '회수완료' 단일 액션(회수는 자동, 도착 후 회수완료 → 완료).
  let kind: "sixshop_claim" | "wconcept_claim";
  let buttonText: string;
  let next: CsReturnStatus;
  if (ret.channel === "wconcept") {
    kind = "wconcept_claim"; buttonText = "회수완료"; next = "done";
  } else {
    const map = resolveButton(action || "", ret.claim_type);
    if (!map) return Response.json({ error: `알 수 없는 action: ${action}` }, { status: 400 });
    kind = "sixshop_claim"; buttonText = map.buttonText; next = map.next;
  }

  try {
    const jobId = await enqueueCsAction(kind, { orderNumber: ret.order_number, buttonText });
    const job = await waitCsAction(jobId);
    if (!job || job.status !== "done") {
      return Response.json({ ok: false, error: job?.error || "처리 시간초과 — 잠시 후 확인" }, { status: 502 });
    }
    await setReturnStatus(id, next);
    return Response.json({ ok: true, status: next });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
