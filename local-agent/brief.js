/**
 * "지금 상황 알려줘" — 세션 시작 브리핑.
 *
 * 왜 필요한가: 사장님은 데스크탑앱·VS Code·모바일 세 곳에서 여러 세션을 쓴다.
 * 세션끼리는 서로의 대화를 못 본다. 그래서 다른 창에서 끝낸 일을 "안 끝났다"고 하거나,
 * 이미 받은 자료를 "없다"고 하는 일이 생긴다(2026-09-08 사장님 지적).
 *
 * 대화는 휘발되지만 **데이터는 남는다**. 그래서 대화를 이어붙이려 하지 말고,
 * 어느 창에서든 이걸 돌려 같은 그림에서 시작한다.
 *
 * 볼 것을 고정해 둔 이유: 그때그때 다른 걸 보면 창마다 브리핑이 달라져 혼선이 그대로다.
 *
 * 실행: node local-agent/brief.js
 */
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
for (const p of [`${DASH}/.env.supabase`, `${DASH}/.env.local`, `${__dirname}/.env`]) {
  try { for (const l of fs.readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  } } catch { /* 없으면 무시 */ }
}
const { createClient } = require(`${DASH}/node_modules/@supabase/supabase-js`);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const today = kst().toISOString().slice(0, 10);
const hhmm = (s) => String(s || "").slice(11, 16);

/** kv_store 는 1000행에서 조용히 잘린다 — 전량이 필요한 곳은 반드시 페이지네이션. */
async function all(table, cols, apply = (q) => q) {
  let out = [], from = 0;
  for (;;) {
    const { data } = await apply(db.from(table).select(cols)).range(from, from + 999);
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

(async () => {
  const L = [];
  L.push(`📋 상황 브리핑 — ${today} ${hhmm(kst().toISOString())} KST\n`);

  // ① 답해야 할 CS
  const { data: un } = await db.from("cs_threads")
    .select("brand,channel,customer_name,customer_handle,last_message_preview,last_message_at")
    .eq("status", "unanswered").order("last_message_at", { ascending: false });
  L.push(`■ 미답변 CS — ${un.length}건`);
  for (const t of (un || []).slice(0, 8))
    L.push(`   ${String(t.last_message_at).slice(5, 16)} ${t.brand}/${t.channel} ${t.customer_name || t.customer_handle || "?"}` +
           `\n      ${String(t.last_message_preview || "").replace(/\s+/g, " ").slice(0, 70)}`);
  if (!un.length) L.push("   (없음)");

  // ② 오늘 접수한 송장
  const ship = (await all("pp_shipments", "channel,req_type,recipient_name,product_name,qty,regi_no,created_at",
    q => q.gte("created_at", today + "T00:00:00Z"))).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const out = ship.filter(s => s.req_type !== "2"), ret = ship.filter(s => s.req_type === "2");
  L.push(`\n■ 오늘 우체국 접수 — 출고 ${out.length} · 회수 ${ret.length}`);
  const byCh = {};
  for (const s of out) byCh[s.channel] = (byCh[s.channel] || 0) + 1;
  if (out.length) L.push("   출고: " + Object.entries(byCh).map(([k, v]) => `${k} ${v}`).join(" · "));
  for (const r of ret) L.push(`   회수: ${r.recipient_name} ${String(r.product_name).slice(0, 26)} (${r.regi_no})`);

  // ③ 끝나지 않은 약속 — 오늘 걸린 것이 진짜 할 일이다
  const { data: pk } = await db.from("kv_store").select("data").eq("key", "cs_promises").maybeSingle();
  const open = ((pk?.data?.items) || []).filter(x => x.status !== "done");
  const due = open.filter(x => x.remindOn && x.remindOn <= today);
  L.push(`\n■ 열린 약속 — ${open.length}건 (오늘 이후 알림 ${due.length}건)`);
  for (const p of due) L.push(`   ⚠️ ${p.customerName || "?"} — ${String(p.text).replace(/\s+/g, " ").slice(0, 80)}`);
  for (const p of open.filter(x => !due.includes(x)))
    L.push(`   · ${p.customerName || "?"} (알림 ${p.remindOn || "-"}) ${String(p.text).replace(/\s+/g, " ").slice(0, 55)}`);

  // ④ 다른 창에서 하던 일 — 이게 세션 간 단절을 메우는 핵심
  const act = await all("kv_store", "key,data,updated_at", q => q.like("key", "today:cc_activity%"));
  const sess = [];
  for (const row of act) for (const s of (row.data?.sessions || []))
    if (String(s.touchedAt || "").slice(0, 10) === today) sess.push(s);
  sess.sort((a, b) => String(b.touchedAt).localeCompare(String(a.touchedAt)));
  L.push(`\n■ 오늘 세션에서 한 일 — ${sess.length}개 세션`);
  for (const s of sess.slice(0, 8)) {
    // 제목은 그 세션의 첫 지시라 무슨 일이었는지 가장 잘 드러난다.
    L.push(`   · [${hhmm(kst(new Date(s.touchedAt)).toISOString())}] ${String(s.title || "").replace(/\s+/g, " ").slice(0, 72)}`);
    // 마지막 지시까지 보면 그 세션이 어디까지 갔는지 알 수 있다.
    const last = (s.turns || []).slice(-1)[0];
    if (last && last.text && last.text !== s.title)
      L.push(`       └ 마지막: ${String(last.text).replace(/\s+/g, " ").slice(0, 62)}`);
  }
  if (!sess.length) L.push("   (오늘 스캔된 세션 없음 — claudeActivityScan 확인)");

  // ⑤ 멈춘 자동화 — 조용히 죽는 게 제일 위험하다
  const hb = await all("kv_store", "key,updated_at", q => q.like("key", "heartbeat:%"));
  const stale = hb.filter(h => (Date.now() - new Date(h.updated_at).getTime()) > 30 * 3600e3);
  L.push(`\n■ 30시간 넘게 안 돈 자동화 — ${stale.length}건`);
  for (const h of stale.slice(0, 8)) L.push(`   🔴 ${h.key.replace("heartbeat:", "")} (마지막 ${String(h.updated_at).slice(0, 16)})`);

  console.log(L.join("\n"));
})().catch(e => { console.error("브리핑 실패:", e.message); process.exit(1); });
