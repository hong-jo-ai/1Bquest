/**
 * AS 수리완료 → 고객 발송 송장 접수 (큐 경유).
 * 접수는 보안키(SEED)+계약 IP 때문에 iMac 워커에서만 실행 가능 → 배포 서버는 큐에 적재만 하고
 * registerQueueWorker.js 가 폴링해 실제 접수한다. (직접 에이전트 호출은 Vercel→127.0.0.1 라 'fetch failed')
 *
 * POST { asId, zip?, prod? }              → { queued:true, jobId, zip }
 * GET  ?jobId=...                          → { job }  (status pending|processing|done|error)
 *   - done & 성공 시 as_requests.return_tracking_no=regiNo, status='shipped' 기록(멱등)
 *
 * 우편번호: body.zip > 주소 내 5자리 > juso 자동조회(addrToZip). 셋 다 실패 시에만 입력 요구.
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enqueueJob, getJob } from "@/lib/postParcel/queue";
import { addrToZip } from "@/lib/postParcel/addrToZip";

export const dynamic = "force-dynamic";

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest) {
  const { asId, zip, prod } = await req.json().catch(() => ({}));
  if (!asId) return Response.json({ error: "asId 필요" }, { status: 400 });

  const client = sb();
  const { data: as, error } = await client.from("as_requests").select("*").eq("id", asId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!as) return Response.json({ error: "AS 접수 없음" }, { status: 404 });

  const addr = as.customer_address || "";
  if (!as.customer_name || !addr) {
    return Response.json({ error: "고객명/주소 누락 (AS 접수에 반송주소 입력 필요)" }, { status: 400 });
  }

  // 우편번호: 직접 전달 > 주소에 박힌 5자리 > juso 자동조회
  let zipCode = String(zip || (addr.match(/\b\d{5}\b/)?.[0] ?? "")).replace(/\D/g, "");
  if (!zipCode) zipCode = (await addrToZip(addr)) ?? "";
  if (!zipCode) {
    return Response.json(
      { error: "우편번호 자동조회 실패 — 우편번호를 직접 입력해주세요" },
      { status: 400 },
    );
  }

  try {
    const jobId = await enqueueJob("one", {
      order: `AS-${asId}`,
      name: as.customer_name,
      addr,
      zip: zipCode,
      mobile: as.customer_phone || "",
      prod: prod || as.model || "수리완료 제품",
      qty: "1",
      source: "AS",
      reqType: "1",
    });
    return Response.json({ queued: true, jobId, zip: zipCode });
  } catch (e) {
    return Response.json({ error: (e as Error).message || "접수 요청 적재 실패" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId 필요" }, { status: 400 });

  const job = await getJob(jobId);
  if (!job) return Response.json({ error: "접수 요청을 찾을 수 없습니다" }, { status: 404 });

  // 접수 성공 시 AS 레코드에 송장 기록 + 발송완료 (워커는 done 일 때만 결과 기록 → done=성공). 멱등.
  if (job.status === "done" && job.result) {
    const r = job.result as { regiNo?: string };
    const order = String((job.payload as { order?: string } | null)?.order || "");
    const asId = order.startsWith("AS-") ? order.slice(3) : "";
    if (asId && r.regiNo) {
      const client = sb();
      const { data: cur } = await client
        .from("as_requests")
        .select("status, return_tracking_no")
        .eq("id", asId)
        .maybeSingle();
      if (cur && cur.status !== "shipped") {
        const isReal = r.regiNo !== "TESTREGINOAPI";
        await client
          .from("as_requests")
          .update({
            return_tracking_no: isReal ? r.regiNo : cur.return_tracking_no,
            status: "shipped",
            shipped_at: new Date().toISOString(),
          })
          .eq("id", asId);
      }
    }
  }

  return Response.json({ job });
}
