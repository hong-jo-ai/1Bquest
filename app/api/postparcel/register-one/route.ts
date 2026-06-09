/**
 * 범용 단발 우체국 접수 — 임의 앱/수동에서 "확인 한 번"으로 택배 접수.
 * 접수는 보안키(SEED)+계약 IP 때문에 iMac 로컬에서만 가능 → 배포 서버는 큐에 적재만 하고,
 * iMac 워커(registerQueueWorker.js)가 폴링해 실제 접수 후 결과를 같은 row 에 기록한다.
 *   POST { order, name, addr|addr1/addr2, zip, mobile|tel, prod, qty?, color?, msg?, source?, reqType? }
 *     → { queued:true, jobId }
 *   GET  ?jobId=...  → { job }   (상태/결과 폴링)
 */
import { type NextRequest } from "next/server";
import { enqueueJob, getJob } from "@/lib/postParcel/queue";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { source, reqType, ...order } = body;
  if (!order.order || !order.name || !(order.addr || order.addr1) || !order.zip) {
    return Response.json({ error: "order, name, addr, zip 필요" }, { status: 400 });
  }
  try {
    const jobId = await enqueueJob("one", {
      ...order,
      source: source || "manual",
      reqType: reqType === "2" ? "2" : "1",
    });
    return Response.json({ queued: true, jobId });
  } catch (e) {
    return Response.json({ error: (e as Error).message || "접수 요청 적재 실패" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId 필요" }, { status: 400 });
  const job = await getJob(jobId);
  if (!job) return Response.json({ error: "해당 접수 요청을 찾을 수 없습니다" }, { status: 404 });
  return Response.json({ job });
}
