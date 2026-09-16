import { createClient } from "@supabase/supabase-js";
import { checkPrintAgent } from "@/lib/print/token";

export const dynamic = "force-dynamic";

/**
 * GET /api/print/jobs — 윈도우 인쇄 에이전트가 20초마다 폴링.
 *  - jobs: 대기(queued) 잡. kind="print"(기본, 서명 URL 포함) 또는 kind="cmd"(원격 PowerShell 명령 — 진단/설정용).
 *  - control: kv `print_agent_control` {restart:true} 면 에이전트가 최신 스크립트를 받아 재기동(한 번 소비 후 해제).
 * 잡은 iMac 의 labelPrintQueue.js(print) 또는 운영자가 kv 에 적재한다. 상태 변경은 에이전트의 ack 에서만.
 * 에이전트는 v·host 쿼리로 자기 버전/호스트명을 알려온다(kv print_agent_seen 에 마지막 접촉 기록).
 */
export async function GET(req: Request) {
  if (!checkPrintAgent(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const url = new URL(req.url);
  const now = new Date().toISOString();
  await sb.from("kv_store").upsert({ key: "print_agent_seen", data: { at: now, version: url.searchParams.get("v"), host: url.searchParams.get("host") }, updated_at: now }, { onConflict: "key" });

  const { data: ctlRow } = await sb.from("kv_store").select("data").eq("key", "print_agent_control").maybeSingle();
  const control = (ctlRow?.data as { restart?: boolean } | null) ?? {};
  if (control.restart) {
    // 한 번만 소비
    await sb.from("kv_store").upsert({ key: "print_agent_control", data: { restart: false, consumed_at: now }, updated_at: now }, { onConflict: "key" });
    return Response.json({ ok: true, jobs: [], control: { restart: true } });
  }

  const { data, error } = await sb.from("kv_store").select("key,data")
    .like("key", "print_job:%").eq("data->>status", "queued").order("updated_at").limit(20);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const jobs = [];
  for (const row of data ?? []) {
    const j = row.data as { id: string; kind?: string; cmd?: string; path?: string; printer?: string; recipient_name?: string; order_number?: string };
    if (j.kind === "cmd") { jobs.push({ id: j.id, kind: "cmd", cmd: j.cmd ?? "" }); continue; }
    if (!j.path) continue;
    // ⚠️ 유효기간을 넉넉히 준다. 한 번 폴링에서 내려보낸 잡들의 URL 이 **전부 같은 시각에 만료**되는데
    //    에이전트는 이걸 순차 처리하고 실측 건당 4~8분이 걸린다. 900초(15분)였을 때
    //    2026-09-16 첫 실전 배치(4건)에서 4번째 건이 만료 69초 뒤에 내려받기를 시도해 400 으로 실패했다
    //    (앞 3건은 통과). 배치가 커질수록 뒷건부터 무조건 깨지는 구조였다.
    const { data: signed } = await sb.storage.from("labels").createSignedUrl(j.path, 3600);
    if (!signed?.signedUrl) continue;
    jobs.push({ id: j.id, kind: "print", url: signed.signedUrl, printer: j.printer || "", label: `${j.recipient_name ?? ""} ${j.order_number ?? ""}`.trim() });
  }
  return Response.json({ ok: true, jobs, control: {} });
}
