/**
 * 우리 메일 전부 검색 — 계정 3개를 한 번에 뒤진다.
 *
 * 왜 필요한가: 메일 계정이 3개인데(shong@harriotwatches.com · harriotwatches@gmail.com ·
 * plvekorea@gmail.com) claude.ai Gmail 커넥터(MCP)는 **shong@ 한 계정에만** 붙어 있다.
 * 그래서 harriotwatches@gmail.com 으로만 온 메일(페덱스 통관 등)을 검색하면 "없음"이 나오고,
 * 세션이 바뀔 때마다 "그 계정은 못 읽는다"고 잘못 답하는 일이 반복됐다(사장님 지적 2026-09-18).
 *
 * 실제로는 세 계정 모두 refresh_token 이 `cs_accounts`(channel=gmail)에 들어 있어 전부 읽힌다.
 * 계정별로 토큰이 흩어져 있던 옛 방식(kv google_refresh_token=shong@,
 * kv kakao_gift_gmail_token=plvekorea@)은 스크립트마다 한 계정만 봐서 이 사고의 원인이었다.
 * → 여기서는 cs_accounts 를 단일 소스로 쓴다.
 *
 * 실행:
 *   node local-agent/mailSearch.js "877051445310"              제목/발신/요약만
 *   node local-agent/mailSearch.js "from:fedex" --full         본문까지
 *   node local-agent/mailSearch.js "통관" --max 30 --account harriotwatches
 *
 * 검색어는 Gmail 검색 문법 그대로(from: to: subject: newer_than:7d 등).
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

const argv = process.argv.slice(2);
const FULL = argv.includes("--full");
// ⚠️ indexOf 가 -1 이면 argv[0](=검색어)을 숫자로 읽어 NaN 이 된다 → Gmail 400 → 예전엔 "(없음)"으로 찍혔다(2026-09-22).
const MAX = argv.includes("--max") ? Math.max(1, Math.min(500, Number(argv[argv.indexOf("--max") + 1]) || 12)) : 12;
const ONLY = argv.includes("--account") ? argv[argv.indexOf("--account") + 1] : "";
const QUERY = argv.filter((a, i) =>
  !a.startsWith("--") && argv[i - 1] !== "--max" && argv[i - 1] !== "--account").join(" ");

if (!QUERY) {
  console.log("사용: node local-agent/mailSearch.js \"<검색어>\" [--full] [--max N] [--account <이름일부>]");
  process.exit(1);
}

async function accessToken(refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(j).slice(0, 160)}`);
  return j.access_token;
}

const header = (msg, name) =>
  ((msg.payload && msg.payload.headers) || []).find((h) => h.name.toLowerCase() === name)?.value || "";

/** 본문에서 text/plain 을 재귀로 찾아 디코드. 없으면 snippet. */
function bodyText(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body && payload.body.data)
    return Buffer.from(payload.body.data, "base64").toString("utf8");
  for (const p of payload.parts || []) { const t = bodyText(p); if (t) return t; }
  return "";
}

(async () => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  // 'paused' 만 제외 — 'error' 계정도 일단 시도해 본다(토큰이 살아 있는 경우가 있다).
  const { data: accounts, error } = await db.from("cs_accounts")
    .select("display_name,credentials,status").eq("channel", "gmail").in("status", ["active", "error"]);
  if (error) { console.log("계정 조회 실패:", error.message); process.exit(1); }

  // --account 매칭 순서: 전체 일치 → @앞 로컬파트 일치 → 부분 포함.
  // ⚠️ 부분 포함만 쓰면 "harriotwatches" 가 shong@harriotwatches.com 까지 잡는다(도메인에 들어 있다).
  const lc = (s) => String(s || "").toLowerCase();
  const all = accounts || [];
  const targets = !ONLY ? all : (() => {
    const q = lc(ONLY);
    const exact = all.filter((a) => lc(a.display_name) === q);
    if (exact.length) return exact;
    const local = all.filter((a) => lc(a.display_name).split("@")[0] === q);
    if (local.length) return local;
    return all.filter((a) => lc(a.display_name).includes(q));
  })();
  if (!targets.length) { console.log("대상 계정 없음"); process.exit(1); }

  console.log(`🔎 "${QUERY}" — 계정 ${targets.length}개\n`);
  let total = 0;

  for (const acc of targets) {
    const name = acc.display_name;
    const rt = acc.credentials && acc.credentials.refresh_token;
    if (!rt) { console.log(`── ${name}: ⚠️ refresh_token 없음 — 재인증 필요\n`); continue; }
    let at;
    try { at = await accessToken(rt); }
    catch (e) { console.log(`── ${name}: ⚠️ ${e.message}\n`); continue; }
    const AT = { Authorization: `Bearer ${at}` };

    let ids = [];
    try {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(QUERY)}&maxResults=${MAX}`,
        { headers: AT, signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      // 오류 응답을 "결과 없음"으로 삼키지 않는다 — 없다고 믿고 잘못 판단하는 게 가장 나쁘다.
      if (!r.ok || j.error) throw new Error(`HTTP ${r.status} ${JSON.stringify(j.error || j).slice(0, 160)}`);
      ids = (j.messages || []).map((m) => m.id);
    } catch (e) { console.log(`── ${name}: ⚠️ 검색 실패 ${e.message}\n`); continue; }

    if (!ids.length) { console.log(`── ${name}: (없음)\n`); continue; }
    console.log(`── ${name}: ${ids.length}건`);

    for (const id of ids) {
      try {
        const m = await (await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: AT, signal: AbortSignal.timeout(20000) })).json();
        const date = new Date(Number(m.internalDate)).toISOString().replace("T", " ").slice(0, 16);
        const unread = (m.labelIds || []).includes("UNREAD") ? " 🔵미읽음" : "";
        console.log(`  [${date}]${unread} ${header(m, "from")}`);
        console.log(`     → ${header(m, "to")}`);
        console.log(`     ${header(m, "subject")}`);
        console.log(`     ${FULL ? "" : (m.snippet || "").replace(/\s+/g, " ").slice(0, 160)}`);
        if (FULL) {
          const t = bodyText(m.payload) || m.snippet || "";
          console.log(t.split("\n").map((l) => "     | " + l).join("\n").slice(0, 4000));
        }
        console.log("");
        total++;
      } catch { /* 한 건 실패는 건너뛴다 */ }
    }
  }
  console.log(`합계 ${total}건`);
})().catch((e) => { console.error("오류:", e.message); process.exit(1); });
