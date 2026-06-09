/**
 * 출고 일괄 접수 — 채널 출고대기 주문을 우체국 일괄 접수.
 * 접수는 iMac 로컬에서만 가능 → 큐에 적재, iMac 워커가 폴링해 registerOutbound 실행.
 *   POST { limit? }  → { queued:true, jobId }
 *   GET  ?jobId=...  → { job }
 */
import { type NextRequest } from "next/server";
import { enqueueJob, getJob } from "@/lib/postParcel/queue";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const jobId = await enqueueJob("outbound", { limit: body.limit });
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
