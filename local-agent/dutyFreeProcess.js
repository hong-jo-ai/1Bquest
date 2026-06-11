/**
 * 면세점 발주 처리 (1단계) — 발주제안서 → 입고서류 PDF 생성 + 드라이브 저장 + 부자재(면세점 박스) 차감 + 출고 이력.
 *
 * 흐름:
 *   ① 입력 폴더에서 최신 신세계·롯데 발주제안서 자동탐색 (롯데는 _최종승인수량 우선)
 *   ② dutyFreeExtract.py 로 품목 추출(JSON) — 출고 이력/검증용
 *   ③ duty_free_docs/generate.py 실행 → 3종 PDF(신세계 패킹리스트·박스라벨, 롯데 거래명세서)
 *   ④ 각 패킹리스트 드라이브 폴더에 PDF 저장
 *   ⑤ 부자재 kv(paulwise:supplies:v1)에서 면세점 박스 −1/면세점 차감 + 출고 이력 적재(멱등: date+store)
 *   ⑥ 텔레그램 요약
 *
 * 전제(iMac): LibreOffice(/Applications) + python3(openpyxl) + 나눔/Noto 한글폰트.
 * CLI: node dutyFreeProcess.js [--sinsegae p] [--lotte p] [--date YYYYMMDD] [--input dir] [--dry]
 */
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
loadEnv(path.join(__dirname, ".env"));
const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const nfc = (s) => s.normalize("NFC");

// ── 경로 설정 (env 로 덮어쓰기 가능) ──
const DRIVE = process.env.DUTYFREE_DRIVE || "/Users/mac/Library/CloudStorage/GoogleDrive-shong@harriotwatches.com/공유 드라이브";
const DF_DIR = process.env.DUTYFREE_PROJECT || path.join(DRIVE, "다운로드/duty_free_docs");
const INPUT_DIR = process.env.DUTYFREE_INPUT || path.join(DRIVE, "다운로드");
const SINSEGAE_OUT = process.env.DUTYFREE_SINSEGAE_DIR || path.join(DRIVE, "제이에이치/폴바이스 면세점/2.신세계 면세점/신세계 패킹리스트");
const LOTTE_OUT = process.env.DUTYFREE_LOTTE_DIR || path.join(DRIVE, "제이에이치/폴바이스 면세점/3.롯데면세점/패킹리스트");
const PY = process.env.DUTYFREE_PYTHON || "/usr/bin/python3"; // launchd 최소 PATH 대비 절대경로 (openpyxl 설치된 시스템 python)
const SUPPLIES_KEY = "paulwise:supplies:v1";
const SHIPLOG_KEY = "paulwise:dutyfree-shipments:v1";

function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true) : def; }
const DRY = !!arg("dry", false);

// 입력 폴더에서 최신 발주제안서 탐색 (NFC 매칭, 롯데는 최종승인수량 우선)
function findOrder(dir, store) {
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const cands = files
    .filter((f) => /\.xlsx$/i.test(f))
    .map((f) => ({ f, n: nfc(f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter((x) => x.n.includes(store) && x.n.includes("발주제안서"))
    .sort((a, b) => b.m - a.m);
  if (!cands.length) return null;
  if (store === "롯데") {
    const fin = cands.find((x) => x.n.includes("최종승인수량"));
    if (fin) return path.join(dir, fin.f);
  }
  return path.join(dir, cands[0].f);
}

function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }

async function kvGet(sb, key) { const { data } = await sb.from("kv_store").select("data").eq("key", key).maybeSingle(); return data?.data ?? null; }
async function kvSet(sb, key, data) { await sb.from("kv_store").upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: "key" }); }
async function tg(msg) { const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID; if (!t || !c) return; await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: c, text: msg }) }).catch(() => {}); }

(async () => {
  const ssArg = arg("sinsegae"), ltArg = arg("lotte");
  const inputDir = arg("input", INPUT_DIR);
  const ss = typeof ssArg === "string" ? ssArg : findOrder(inputDir, "신세계");
  const lt = typeof ltArg === "string" ? ltArg : findOrder(inputDir, "롯데");
  if (!ss && !lt) { log(`발주제안서를 못 찾음 (${inputDir})`); await tg("📦 면세점 발주 처리: 발주제안서를 찾지 못했습니다."); return; }
  const stores = [];
  if (ss) { log(`신세계 발주제안서: ${nfc(path.basename(ss))}`); stores.push("신세계"); }
  if (lt) { log(`롯데 발주제안서: ${nfc(path.basename(lt))}`); stores.push("롯데"); }

  const dateArg = arg("date");
  const date = typeof dateArg === "string" ? dateArg : ymd(new Date());

  // ② 품목 추출
  let items = {};
  try { items = JSON.parse(execFileSync(PY, [path.join(__dirname, "dutyFreeExtract.py"), DF_DIR, ss || "", lt || ""], { encoding: "utf8", maxBuffer: 8 << 20 })); }
  catch (e) { log("품목 추출 실패: " + (e.message || e)); }
  const ssN = (items.sinsegae || []).length, ssQ = (items.sinsegae || []).reduce((a, i) => a + i.qty, 0);
  const ltN = (items.lotte || []).length, ltQ = (items.lotte || []).reduce((a, i) => a + i.qty, 0);
  if (ss) log(`  신세계 ${ssN}품목 / ${ssQ}pcs`);
  if (lt) log(`  롯데 ${ltN}품목 / ${ltQ}pcs`);

  // ③ generate.py → PDF
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dutyfree-"));
  const gArgs = [path.join(DF_DIR, "generate.py"), "--date", date, "--output", outDir];
  if (ss) gArgs.push("--sinsegae", ss);
  if (lt) gArgs.push("--lotte", lt);
  if (DRY) { log(`[DRY] generate.py ${gArgs.join(" ")}`); }
  else {
    try { const o = execFileSync(PY, gArgs, { encoding: "utf8", maxBuffer: 16 << 20 }); log("generate.py:\n" + o.trim().split("\n").map((l) => "  " + l).join("\n")); }
    catch (e) { log("generate.py 실패: " + (e.stdout || "") + (e.message || e)); await tg("📦 면세점 발주 처리 실패: PDF 생성 오류"); return; }
  }

  // ④ 드라이브 폴더에 저장
  const saved = [];
  if (!DRY) {
    const pdfs = fs.readdirSync(outDir).filter((f) => /\.pdf$/i.test(f));
    for (const f of pdfs) {
      const nf = nfc(f);
      const isLotte = nf.includes("롯데");
      const dest = isLotte ? LOTTE_OUT : SINSEGAE_OUT;
      try { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(path.join(outDir, f), path.join(dest, f)); saved.push(nf); log(`  저장: ${nf} → ${isLotte ? "롯데" : "신세계"} 패킹리스트`); }
      catch (e) { log(`  저장 실패 ${nf}: ${e.message}`); }
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  } else log(`[DRY] PDF 저장 생략`);

  // ⑤ 부자재(면세점 박스) 차감 + 출고 이력 (멱등: date+store)
  let boxMsg = "";
  if (!DRY) {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const shipLog = (await kvGet(sb, SHIPLOG_KEY)) || [];
    const supplies = await kvGet(sb, SUPPLIES_KEY);
    const newStores = stores.filter((s) => !shipLog.some((e) => e.date === date && e.store === s));
    if (supplies && Array.isArray(supplies)) {
      const box = supplies.find((x) => x.id === "box-dutyfree");
      if (box && newStores.length) {
        const before = box.currentStock;
        box.currentStock = Math.max(0, before - newStores.length);
        await kvSet(sb, SUPPLIES_KEY, supplies);
        boxMsg = `면세점 박스 −${newStores.length} (${before}→${box.currentStock}${before - newStores.length < 0 ? ", ⚠️박스 부족" : ""})`;
      } else if (!newStores.length) boxMsg = "박스 차감: 이미 처리됨(멱등 스킵)";
    } else { boxMsg = "⚠️ 부자재 미초기화(대시보드 1회 열어 시드 필요) — 박스 미차감"; }
    // 출고 이력 적재
    for (const s of newStores) {
      const it = s === "신세계" ? (items.sinsegae || []) : (items.lotte || []);
      shipLog.push({ date, store: s, boxes: 1, itemCount: it.length, qty: it.reduce((a, i) => a + i.qty, 0), items: it, at: new Date().toISOString() });
    }
    if (newStores.length) await kvSet(sb, SHIPLOG_KEY, shipLog);
  } else boxMsg = "[DRY] 박스 미차감";
  log("  " + boxMsg);

  // ⑥ 텔레그램
  const lines = ["📦 면세점 발주 처리 (출고일 " + date.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3") + ")"];
  if (ss) lines.push(`• 신세계: ${ssN}품목 / ${ssQ}pcs`);
  if (lt) lines.push(`• 롯데: ${ltN}품목 / ${ltQ}pcs`);
  if (saved.length) lines.push(`• 서류 ${saved.length}건 생성·드라이브 저장`);
  lines.push(`• ${boxMsg}`);
  await tg(lines.join("\n"));
  log("완료");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
