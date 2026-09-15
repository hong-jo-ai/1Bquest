import { createClient } from "@supabase/supabase-js";
import { checkPrintAgent } from "@/lib/print/token";

export const dynamic = "force-dynamic";

/**
 * GET /api/print/jobs — 윈도우 인쇄 에이전트가 폴링. 대기(queued) 잡을 서명 URL 과 함께 돌려준다.
 * 잡은 iMac 의 labelPrintQueue.js 가 kv `print_job:<id>` 로 적재한다. 여기서는 상태를 바꾸지 않는다
 * (에이전트가 인쇄 후 /api/print/jobs/{id}/ack 로 결과를 보고).
 */
export async function GET(req: Request) {
  if (!checkPrintAgent(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.from("kv_store").select("key,data")
    .like("key", "print_job:%").eq("data->>status", "queued").order("updated_at").limit(20);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const jobs = [];
  for (const row of data ?? []) {
    const j = row.data as { id: string; path: string; printer?: string; recipient_name?: string; order_number?: string };
    const { data: signed } = await sb.storage.from("labels").createSignedUrl(j.path, 900);
    if (!signed?.signedUrl) continue;
    jobs.push({ id: j.id, url: signed.signedUrl, printer: j.printer || "", label: `${j.recipient_name ?? ""} ${j.order_number ?? ""}`.trim() });
  }
  return Response.json({ ok: true, jobs });
}
