/**
 * 우체국 운송장 라벨 인쇄 큐 — 접수된 출고 소포를 라벨 PDF 로 만들어 인쇄 대기열에 올린다.
 *
 *   pp_shipments(req_type=1, submitted, 실접수) → renderLabel → Storage `labels/` 업로드
 *   → kv `print_job:<regi_no>` {status:"queued"} → 윈도우 노트북의 print-agent.ps1 이
 *   /api/print/jobs 로 가져가 PS100 에 인쇄하고 ack.
 *
 * 왜 iMac 에서 렌더하나: 한글 폰트(AppleGothic)가 여기 있고, 접수 응답(raw)도 이 DB 에 있다.
 * Vercel 에는 한글 폰트가 없다.
 *
 * 실행: node labelPrintQueue.js            (최근 2일 접수분 중 미적재 건)
 *       node labelPrintQueue.js --test     (프린터 연결 확인용 테스트 라벨 1장)
 *       node labelPrintQueue.js --only 6890174004831
 *       node labelPrintQueue.js --only 6890174004831 --reprint   (이미 인쇄한 건 다시)
 * launchd: com.paulvice.label-print-queue (5분). 인쇄 대상이 없어도 beat.
 */
const fs = require("fs"), path = require("path");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; const v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
loadEnv(path.join(DASH, ".env.local")); loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const { renderLabel, renderTestLabel } = require("./labelPrint/renderLabel");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BUCKET = "labels";
const PREFIX = "print_job:";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const ymd = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/-/g, "");

async function enqueue(regiNo, pdf, meta) {
  const objectPath = `${ymd()}/${regiNo}.pdf`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(objectPath, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`업로드 실패 ${regiNo}: ${upErr.message}`);
  const now = new Date().toISOString();
  const job = { id: regiNo, status: "queued", path: objectPath, printer: process.env.LABEL_PRINTER || "", created_at: now, updated_at: now, attempts: 0, error: null, ...meta };
  const { error } = await sb.from("kv_store").upsert({ key: PREFIX + regiNo, data: job, updated_at: now }, { onConflict: "key" });
  if (error) throw new Error(`큐 적재 실패 ${regiNo}: ${error.message}`);
  return job;
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes("--test")) {
    const id = "TEST-" + Date.now();
    const pdf = await renderTestLabel(new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }));
    const job = await enqueue(id, pdf, { order_number: "TEST", recipient_name: "테스트", channel: "test" });
    log(`테스트 라벨 적재: ${job.id} (${pdf.length} bytes)`);
    return;
  }
  const only = args[args.indexOf("--only") + 1];
  // ⚠️ 활성화 시각(kv label_print_since) 이후 접수분만. 첫 실행이 최근 2일치 74건을 통째로 큐에 올렸다
  //    (전부 biz.epost 에서 이미 인쇄·발송된 것) → 프린터가 붙는 순간 74장이 쏟아질 뻔했다(2026-09-15).
  const { data: sinceRow } = await sb.from("kv_store").select("data").eq("key", "label_print_since").maybeSingle();
  const since = sinceRow?.data?.since || new Date().toISOString();
  if (!sinceRow) await sb.from("kv_store").upsert({ key: "label_print_since", data: { since }, updated_at: since }, { onConflict: "key" });
  let q = sb.from("pp_shipments").select("*").eq("req_type", "1").eq("status", "submitted").eq("is_test", false).gte("registered_at", since).order("registered_at");
  if (args.includes("--only") && only) q = sb.from("pp_shipments").select("*").eq("regi_no", only);
  const { data: rows, error } = await q;
  if (error) throw error;
  // 이미 큐에 올린 건 제외
  const keys = (rows || []).map((r) => PREFIX + r.regi_no);
  const { data: existing } = keys.length ? await sb.from("kv_store").select("key").in("key", keys) : { data: [] };
  const done = new Set((existing || []).map((k) => k.key));
  // --reprint: 이미 인쇄한 건도 다시(라벨 양식을 고친 뒤 재출력 — 2026-09-28 상품명 잘림 건). --only 와 함께만.
  const reprint = args.includes("--reprint") && args.includes("--only");
  const todo = (rows || []).filter((r) => r.regi_no && (reprint || !done.has(PREFIX + r.regi_no)));
  log(`접수분 ${rows?.length ?? 0} · 신규 인쇄대상 ${todo.length}`);
  // 합포장(같은 등기번호 여러 줄)은 라벨 한 장에 전 품목을 싣는다. 줄마다 돌면 첫 줄만 그려지고
  // 나머지는 "이미 큐에 있음"으로 버려져 포장 누락이 났다(2026-09-30 무신사 김지연·카페24 박지현).
  // 형제 줄이 이번 조회 범위 밖일 수 있어 등기번호로 다시 읽는다.
  const regis = [...new Set(todo.map((r) => r.regi_no))];
  const { data: sibs } = regis.length ? await sb.from("pp_shipments").select("*").in("regi_no", regis).eq("req_type", "1").eq("status", "submitted") : { data: [] };
  const byRegi = new Map();
  for (const r of sibs || []) (byRegi.get(r.regi_no) || byRegi.set(r.regi_no, []).get(r.regi_no)).push(r);
  const seen = new Set();
  let n = 0;
  for (const s of todo) {
    if (seen.has(s.regi_no)) continue;
    seen.add(s.regi_no);
    try {
      const group = (byRegi.get(s.regi_no) || [s]).sort((a, b) => String(a.registered_at).localeCompare(String(b.registered_at)));
      const pdf = await renderLabel(group.length > 1 ? { ...s, _items: group } : s);
      await enqueue(s.regi_no, pdf, { order_number: s.order_number, recipient_name: s.recipient_name, channel: s.channel, shipment_id: s.id });
      n++; log(`  적재 ${s.regi_no} ${s.recipient_name} (${s.channel})`);
    } catch (e) { log(`  ❌ ${s.regi_no}: ${e.message}`); }
  }
  log(`완료 — ${n}건 적재`);
  try { await require("./heartbeat").beat("label-print-queue"); } catch {}
})().catch(async (e) => {
  console.error("실패:", e.message);
  try { await require("./notifyFail").notifyFail("라벨 인쇄 큐 실패", e.message); } catch {}
  process.exit(1);
});
