/**
 * 실버데이 행사제안 — Google Sheet 행사제안 탭 읽기/쓰기.
 *   node silverdayProposal.js read   ← 탭/제품 데이터 덤프
 *   node silverdayProposal.js write   ← 행사제안 행 작성
 * shong@ = kv google_refresh_token (spreadsheets write scope).
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path");
const DASH = path.resolve(__dirname, "..");
function le(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
le(path.join(DASH, ".env.supabase")); le(path.join(DASH, ".env.local")); le(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SHEET = "1v9BOUCNCDTE1X5rBjza-b_j4Ow6C5613U-OTo3dBL7k";

async function token() {
  const { data } = await sb().from("kv_store").select("data").eq("key", "google_refresh_token").maybeSingle();
  const refresh = data && data.data;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: String(refresh), grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`토큰 갱신 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}
async function api(tok, method, urlpath, body) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${urlpath}`, {
    method, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 400)}`);
  return j;
}

(async () => {
  const tok = await token();
  const mode = process.argv[2] || "read";
  const meta = await api(tok, "GET", SHEET);
  const tabs = meta.sheets.map((s) => ({ title: s.properties.title, gid: s.properties.sheetId, rows: s.properties.gridProperties.rowCount, cols: s.properties.gridProperties.columnCount }));
  console.log("TABS:", JSON.stringify(tabs, null, 1));

  if (mode === "read") {
    const want = (process.argv[3] || "행사제안").split(",");
    for (const title of want) {
      const r = await api(tok, "GET", `${SHEET}/values/${encodeURIComponent(title + "!A1:Z80")}?majorDimension=ROWS`);
      console.log(`\n===== [${title}] =====`);
      (r.values || []).forEach((row, i) => console.log(String(i + 1).padStart(3), JSON.stringify(row)));
    }
  }
  if (mode === "write") {
    // C열(행사일자)~J열(추가프로모션). B열(행사구분)은 기존값 유지. 행 35~42.
    const P = "특별 선물 패키지 포장 + 메시지카드";
    const D = "7/13-7/19"; // 실버데이 행사기간(피오르드 김수환 메일 기준, 7/14 당일)
    const rows = [
      // 행사구분, 행사일자, 상품번호, 상품명, 정상가, 행사가, 할인율, 재고, 추가프로모션
      // 핫딜 = 소재까지 실버인 '볼 펜던트 목걸이'로 교체(피오르드 2026-06-17 회신: 핫딜은 실버 소재 필수)
      ["핫딜(히어로)", D, "12062442", "볼 펜던트 실버 목걸이", "₩39,000", "₩33,000", "15%", "23", `${P} / 실버데이 단독 핫딜 (실버 소재)`], // 35
      ["브랜드위크", D, "13724207", "큐빅 커프 팔찌 - 실버", "₩54,000", "₩42,000", "22%", "48", P], // 36 (기존 핫딜→강등)
      ["브랜드위크", D, "12062781", "큐빅 싱글라인 실버 테니스 팔찌", "₩49,000", "₩43,000", "12%", "33", P], // 37
      ["브랜드위크", D, "12062740", "볼비드 실버 하트 펜던트 팔찌", "₩49,000", "₩37,000", "24%", "20", P], // 38
      ["브랜드위크", D, "12062384", "큐빅 펜던트 실버 목걸이", "₩39,000", "₩33,000", "15%", "19", P], // 39
      ["브랜드위크", D, "12060350", "큐빅 귀걸이 4mm (2종 택1)", "₩28,000", "₩23,000", "18%", "19", P], // 40
      ["브랜드위크", "", "", "", "", "", "", "", ""], // 41 (빈 슬롯)
    ];
    const res = await api(tok, "PUT", `${SHEET}/values/${encodeURIComponent("행사제안!B35:J41")}?valueInputOption=USER_ENTERED`, {
      range: "행사제안!B35:J41", majorDimension: "ROWS", values: rows,
    });
    console.log("WROTE:", JSON.stringify(res));
  }
})().catch((e) => { console.error("오류:", e.message); process.exit(1); });
