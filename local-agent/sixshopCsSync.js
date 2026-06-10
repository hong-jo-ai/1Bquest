/**
 * 식스샵 CS 동기화 — 반품/교환/취소 클레임을 CS 인박스로 보냄.
 * 소스: 식스샵 국내 export 의 '주문 상태' 컬럼(반품 요청/반품 수거 중/완료 등). export를 새로 받아 파싱.
 * (문의/게시판은 위치 확정 후 별도 추가)
 *
 * 흐름: refreshSixshopOutbound()로 최신 export 다운 → 클레임 행 파싱 → POST /api/cs/ingest/sixshop-returns.
 * 서버가 멱등 upsert(활성=요청·수거중 생성/갱신, 완료/거부는 기존건만 갱신).
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), os = require("os");
const XLSX = require("xlsx");
const { refreshSixshopOutbound } = require("./sixshopOutboundExport");

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
function env(n) { return process.env[n] || ""; }
function base() { return (env("DASHBOARD_URL") || "https://paulvice-dashboard.vercel.app").replace(/\/$/, ""); }
const clean = (v) => { const s = String(v ?? "").trim(); return s === "-" ? "" : s; };

// 식스샵 '주문 상태' → { claimType, status }. 활성=요청/수거중, 완료/거부=done/rejected. '(네이버페이 주문형)' 접미 무시.
function mapClaim(statusText) {
  const s = String(statusText || "").replace(/\(네이버페이[^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (/취소\s*요청/.test(s)) return { claimType: "cancel", status: "requested" };
  if (/취소\s*완료/.test(s)) return { claimType: "cancel", status: "done" };
  if (/취소\s*거부|취소\s*반려/.test(s)) return { claimType: "cancel", status: "rejected" };
  if (/반품\s*요청/.test(s)) return { claimType: "return", status: "requested" };
  if (/반품\s*수거/.test(s)) return { claimType: "return", status: "in_transit" };
  if (/반품\s*완료/.test(s)) return { claimType: "return", status: "done" };
  if (/반품\s*거부|반품\s*반려/.test(s)) return { claimType: "return", status: "rejected" };
  if (/교환\s*요청/.test(s)) return { claimType: "exchange", status: "requested" };
  if (/교환\s*수거/.test(s)) return { claimType: "exchange", status: "in_transit" };
  if (/교환\s*완료|교환\s*재배송/.test(s)) return { claimType: "exchange", status: "done" };
  if (/교환\s*거부|교환\s*반려/.test(s)) return { claimType: "exchange", status: "rejected" };
  return null; // 일반 주문상태(결제완료/배송중 등)
}

function latestExport() {
  const dir = path.join(os.tmpdir(), "paulvice-marketplace-downloads");
  if (!fs.existsSync(dir)) return null;
  const cands = fs.readdirSync(dir).filter((x) => x.includes("국내") && /\.xlsx$/.test(x))
    .map((x) => ({ x, m: fs.statSync(path.join(dir, x)).mtimeMs })).sort((a, b) => b.m - a.m);
  return cands.length ? path.join(dir, cands[0].x) : null;
}

function parseClaims(file) {
  const wb = XLSX.readFile(file);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const C = { name: 0, order: 6, status: 8, pname: 47 };
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const m = mapClaim(data[i][C.status]);
    if (!m) continue;
    out.push({
      orderNumber: clean(data[i][C.order]),
      claimType: m.claimType,
      status: m.status,
      product: clean(data[i][C.pname]),
      customerName: clean(data[i][C.name]),
      raw: { statusText: clean(data[i][C.status]) },
    });
  }
  return out.filter((c) => c.orderNumber);
}

(async () => {
  log("=== 식스샵 CS 동기화 시작 ===");
  // 최신 export 확보 (실패 시 직전 export 사용)
  try { await refreshSixshopOutbound(); } catch (e) { log("export 갱신 실패(직전 export 사용): " + e.message); }
  const file = latestExport();
  if (!file) { log("식스샵 export 없음 — 중단"); return; }
  const claims = parseClaims(file);
  const act = claims.filter((c) => c.status === "requested" || c.status === "in_transit").length;
  log(`클레임 ${claims.length}건 파싱 (활성 ${act}) — ${file.split("/").pop()}`);
  if (!claims.length) { log("클레임 없음"); return; }

  const res = await fetch(`${base()}/api/cs/ingest/sixshop-returns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-token": env("PAULWISE_MCP_TOKEN") },
    body: JSON.stringify({ claims }),
  });
  const j = await res.json().catch(() => ({}));
  log(`적재 결과: ${JSON.stringify(j)}`);
  log("=== 완료 ===");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
