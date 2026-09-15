import { createClient } from "@supabase/supabase-js";
import { checkPrintAgent } from "@/lib/print/token";

export const dynamic = "force-dynamic";

/** POST /api/print/jobs/{id}/ack  { status: "printed" | "error", error?, printer? } — 에이전트의 인쇄 결과 보고 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkPrintAgent(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: { status?: string; error?: string; printer?: string } = {};
  try { body = await req.json(); } catch { /* 빈 바디 허용 */ }
  const status = body.status === "printed" ? "printed" : "error";
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const key = "print_job:" + id;
  const { data } = await sb.from("kv_store").select("data").eq("key", key).maybeSingle();
  if (!data) return Response.json({ error: "job not found" }, { status: 404 });
  const prev = data.data as Record<string, unknown>;
  const now = new Date().toISOString();
  const next = {
    ...prev, status, updated_at: now,
    attempts: Number(prev.attempts ?? 0) + 1,
    error: status === "error" ? String(body.error ?? "unknown").slice(0, 300) : null,
    printed_at: status === "printed" ? now : prev.printed_at ?? null,
    printer_used: body.printer ?? prev.printer_used ?? null,
  };
  // 3번 실패하면 더 안 돌게 status 를 failed 로 — 에이전트가 같은 잡을 무한 재시도하지 않도록
  if (status === "error" && Number(next.attempts) >= 3) next.status = "failed";
  await sb.from("kv_store").upsert({ key, data: next, updated_at: now }, { onConflict: "key" });
  return Response.json({ ok: true, status: next.status });
}
