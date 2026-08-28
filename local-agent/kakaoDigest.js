/**
 * 카카오톡 대화 요약 — /today 보드의 "카톡에서 넘어온 일" 원천.
 *
 *   node kakaoDigest.js [--days 2] [--dir ~/KakaoExports] [--retain 30] [--dry]
 *
 * 카카오톡 공식 "대화 내용 내보내기"로 나온 CSV(Date,User,Message)를 읽어
 * 최근 N일치만 클로드에게 넘겨 "나와 관련된 것"만 뽑아낸다.
 *
 * 설계 원칙 — 원문은 이 맥을 떠나지 않는다.
 *   단톡방 원문에는 남의 사적인 대화가 그대로 들어있다. Supabase 로 올라가는 것은
 *   추출된 항목(내 할일·내가 기다리는 것·알아둘 것)뿐이고, CSV 원문은 로컬에만
 *   두었다가 --retain 일이 지나면 지운다.
 *
 * 로컬 DB 직접 읽기는 하지 않는다: 카카오톡 저장소는 통째로 암호화돼 있어
 * 실행 중인 앱에서 키를 빼내야 하고, 그건 약관 위반인 데다 업데이트마다 깨진다.
 */
const fs = require("fs"), path = require("path"), os = require("os");
const { beat } = require("./heartbeat");

const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p){ try { for (const l of fs.readFileSync(p,"utf8").split("\n")){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(!m)continue; let v=m[2].trim().replace(/^["']|["']$/g,""); if(!(m[1] in process.env)) process.env[m[1]]=v; } } catch {} }
loadEnv(path.join(DASH,".env.local")); loadEnv(path.join(DASH,".env.supabase")); loadEnv(path.join(DASH,"local-agent/.env"));

const KEY   = "today:kakao_digest";
const ME    = "홍성조";                 // 카카오톡 표시 이름 — 내 발화를 가려내는 기준
const MODEL = "claude-sonnet-5";
/** 방 하나당 클로드에 넘길 최대 메시지 수. 넘치면 최근 것부터 자른다. */
const MAX_MSGS_PER_ROOM = 400;

const args   = process.argv.slice(2);
const DRY    = args.includes("--dry");
const num    = (flag, dflt) => { const i = args.indexOf(flag); const v = i >= 0 ? Number(args[i+1]) : NaN; return Number.isFinite(v) && v > 0 ? v : dflt; };
const DAYS   = num("--days", 2);
const RETAIN = num("--retain", 30);
const DIR    = (() => { const i = args.indexOf("--dir"); const v = i >= 0 ? args[i+1] : null;
  return v ? v.replace(/^~/, os.homedir()) : path.join(os.homedir(), "KakaoExports"); })();

/* ── CSV 파싱 (RFC4180) ─────────────────────────────────────────────────────
   메시지에 줄바꿈과 따옴표가 그대로 들어있어서 줄 단위로 자르면 깨진다. */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const rows = []; let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** 파일명에서 방 이름 뽑기: KakaoTalk_Chat_<방이름>_<2026-08-05-14-21-52>.csv */
function roomOf(filename) {
  const m = filename.match(/^KakaoTalk_Chat_(.+)_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
  return m ? m[1] : filename.replace(/\.csv$/, "");
}

function readRoomFiles(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".csv")); }
  catch { return { rooms: [], missingDir: true }; }

  // 같은 방을 여러 번 내보냈으면 가장 최근 파일만 쓴다.
  const newest = new Map();
  for (const f of files) {
    const room = roomOf(f);
    const st = fs.statSync(path.join(dir, f));
    const cur = newest.get(room);
    if (!cur || st.mtimeMs > cur.mtimeMs) newest.set(room, { file: f, mtimeMs: st.mtimeMs });
  }
  return { rooms: [...newest.entries()].map(([room, v]) => ({ room, ...v })), missingDir: false };
}

function recentMessages(dir, file, sinceMs) {
  const rows = parseCsv(fs.readFileSync(path.join(dir, file), "utf8"));
  const head = rows[0] || [];
  const iD = head.indexOf("Date"), iU = head.indexOf("User"), iM = head.indexOf("Message");
  if (iD < 0 || iU < 0 || iM < 0) return { msgs: [], badHeader: true };

  const msgs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[iD]) continue;
    // "2026-08-05 10:49:25" — 로컬(KST) 시각이다.
    const t = Date.parse(r[iD].replace(" ", "T") + "+09:00");
    if (!Number.isFinite(t) || t < sinceMs) continue;
    msgs.push({ date: r[iD], user: r[iU], text: (r[iM] || "").replace(/\s+/g, " ").trim() });
  }
  return { msgs, badHeader: false };
}

/* ── 요약 ──────────────────────────────────────────────────────────────── */

const SYSTEM = `너는 ${ME}의 업무 비서다. 카카오톡 대화 기록에서 ${ME}가 실제로 챙겨야 할 것만 골라낸다.

반드시 지킬 것:
- ${ME} 본인과 무관한 잡담·인사·이모티콘·링크 공유는 전부 버린다.
- 추측해서 만들어내지 않는다. 대화에 근거가 없으면 넣지 않는다.
- 남의 사생활(건강·가족·금전 등)은 ${ME}가 대응해야 하는 경우가 아니면 넣지 않는다.
- 항목 제목은 대화 원문을 그대로 옮기지 말고, 무엇을 해야 하는지 한 줄로 쓴다.

domain 분류:
- paulvice: 폴바이스(여성 시계·주얼리 자사몰, 국내)
- harriot: 해리엇(영문권 시계 브랜드)
- ars: 아르스 필하모닉 오케스트라 운영(단원·회비·출석·연습·연주회)
- personal: 그 외 개인(독서모임·중진공·가족·사이드 프로젝트 개발 등)

kind 분류:
- todo: ${ME}가 해야 할 일
- waiting: ${ME}가 남의 답을 기다리는 것
- fyi: 행동은 필요 없지만 알아둬야 할 것

JSON만 출력한다. 형식:
{"summary":"이 방에서 오간 일 두 문장 이내","items":[{"title":"...","domain":"paulvice","kind":"todo","who":"요청한 사람 또는 빈 문자열","due":"YYYY-MM-DD 또는 빈 문자열"}]}
건질 게 없으면 {"summary":"","items":[]} 를 출력한다.`;

async function summarizeRoom(client, room, msgs) {
  const truncated = msgs.length > MAX_MSGS_PER_ROOM;
  const use = truncated ? msgs.slice(-MAX_MSGS_PER_ROOM) : msgs;
  const body = use.map((m) => `${m.date} ${m.user}: ${m.text}`).join("\n");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: `방 이름: ${room}\n최근 ${DAYS}일 대화 ${use.length}건${truncated ? " (오래된 것 잘림)" : ""}\n\n${body}` }],
  });

  const text = (res.content.find((c) => c.type === "text") || {}).text || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`JSON 못 찾음: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(m[0]);
  return {
    room,
    messages: msgs.length,
    truncated,
    summary: String(parsed.summary || ""),
    items: Array.isArray(parsed.items) ? parsed.items : [],
  };
}

/** --retain 일 지난 원문 CSV 삭제. 이 폴더의 카톡 내보내기 파일만 건드린다. */
function prune(dir) {
  const cutoff = Date.now() - RETAIN * 86400_000;
  const removed = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^KakaoTalk_Chat_.+\.csv$/.test(f)) continue;   // 다른 파일은 절대 안 지운다
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs >= cutoff) continue;
    if (!DRY) fs.unlinkSync(p);
    removed.push(f);
  }
  return removed;
}

/* ── 본체 ──────────────────────────────────────────────────────────────── */

(async () => {
  const { rooms, missingDir } = readRoomFiles(DIR);
  if (missingDir) {
    if (!DRY) fs.mkdirSync(DIR, { recursive: true });
    console.log(`내보내기 폴더가 없어 만들었다: ${DIR}`);
    console.log("카카오톡에서 '대화 내용 내보내기'한 CSV를 여기에 넣으면 된다.");
    return;
  }
  if (rooms.length === 0) { console.log(`${DIR} 에 CSV 없음 — 할 일 없음`); return; }

  const sinceMs = Date.now() - DAYS * 86400_000;
  const withMsgs = [];
  for (const r of rooms) {
    const { msgs, badHeader } = recentMessages(DIR, r.file, sinceMs);
    if (badHeader) { console.log(`  [건너뜀] ${r.room} — Date,User,Message 헤더가 아님`); continue; }
    console.log(`  ${r.room}: 최근 ${DAYS}일 ${msgs.length}건`);
    if (msgs.length) withMsgs.push({ room: r.room, msgs });
  }
  if (withMsgs.length === 0) { console.log("최근 대화 없음 — 요약 생략"); return; }

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY 없음");
  const Anthropic = require(path.join(DASH, "node_modules/@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const results = [];
  for (const { room, msgs } of withMsgs) {
    try {
      const r = await summarizeRoom(client, room, msgs);
      results.push(r);
      console.log(`  → ${room}: 항목 ${r.items.length}개`);
      for (const it of r.items) console.log(`      [${it.kind}/${it.domain}] ${it.title}`);
    } catch (e) {
      console.log(`  → ${room}: 요약 실패 — ${e.message}`);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    days: DAYS,
    rooms: results,
  };

  const removed = prune(DIR);
  if (removed.length) console.log(`원문 정리(${RETAIN}일 경과): ${removed.length}개 ${DRY ? "(dry)" : "삭제"}`);

  if (DRY) { console.log("--dry: 적재 생략"); return; }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE env 없음");
  const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await db.from("kv_store")
    .upsert({ key: KEY, data: payload, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`kv_store 적재 실패: ${error.message}`);

  const total = results.reduce((n, r) => n + r.items.length, 0);
  console.log(`적재 완료 → ${KEY} (방 ${results.length}, 항목 ${total})`);
  await beat("kakao-digest", { rooms: results.length, items: total });
})().catch((e) => { console.error("[kakaoDigest]", e.message); process.exit(1); });
