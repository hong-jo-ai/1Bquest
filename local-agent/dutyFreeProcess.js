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
const { registerSingle } = require("./postParcel/register");
// 면세점 입고처(우체국 송장 받는분). zip 비우면 registerSingle 이 주소로 자동조회. 전화는 유선(032)→tel.
const RECIPIENTS = {
  신세계: { name: "신세계면세점", addr: "인천광역시 중구 자유무역로107번길 25(운서동) 은산물류창고내 신세계면세점(토산)", tel: "032-744-0866", zip: "23257" },
  롯데: { name: "롯데면세점", addr: "인천광역시 중구 공항동로296번길 97-26(운서동) 한국면세점협회 제2통합물류창고 자유무역지역 E1부지", tel: "032-743-0444", zip: "23257" },
};

function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true) : def; }
const DRY = !!arg("dry", false);

// 입력 폴더에서 최신 발주제안서 탐색 (NFC 매칭, 롯데는 최종승인수량 우선)
// 최근 N시간 내 받은(수정된) 발주서만 처리 대상 — 옛 차수 파일이 폴더에 남아도 무시.
// 워크플로: 사장님이 발주서를 다운로드 폴더에 넣고 → 승인 후 "면세점 발주" 트리거.
const FRESH_MS = Number(process.env.DUTYFREE_FRESH_HOURS || 48) * 3600 * 1000;
function findOrder(dir, store) {
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const now = Date.now();
  const cands = files
    .filter((f) => /\.xlsx$/i.test(f))
    .map((f) => ({ f, n: nfc(f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter((x) => x.n.includes(store) && x.n.includes("발주제안서"))
    .filter((x) => now - x.m <= FRESH_MS)   // ← 최근 발주서만 (옛 차수 파일·발주 안 한 면세점 제외)
    .sort((a, b) => b.m - a.m);
  if (!cands.length) return null;
  if (store === "롯데") {
    // 최종승인수량 우선은 '최근 받은' 파일들 사이에서만 적용 (옛 차수의 최종승인 파일을 집지 않음)
    const fin = cands.find((x) => x.n.includes("최종승인수량"));
    if (fin) return path.join(dir, fin.f);
  }
  return path.join(dir, cands[0].f);
}

function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }

async function kvGet(sb, key) { const { data } = await sb.from("kv_store").select("data").eq("key", key).maybeSingle(); return data?.data ?? null; }
async function kvSet(sb, key, data) { await sb.from("kv_store").upsert({ key, data, updated_at: new Date().toISOString() }, { onConflict: "key" }); }

// cafe24 토큰 (kv_store refresh_token, 만료 시 갱신)
async function cafe24Token(sb) {
  const BASE = `https://${process.env.CAFE24_MALL_ID}.cafe24api.com`;
  const { data } = await sb.from("kv_store").select("data").eq("key", "cafe24_refresh_token").maybeSingle();
  let t = data && data.data; if (typeof t === "string") t = { access_token: "", refresh_token: t, expires_at: 0 };
  if (!t) throw new Error("cafe24 refresh_token 없음");
  if (t.access_token && t.expires_at && t.expires_at - 90000 > Date.now()) return t.access_token;
  const res = await fetch(`${BASE}/api/v2/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${process.env.CAFE24_CLIENT_ID}:${process.env.CAFE24_CLIENT_SECRET}`).toString("base64") }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}` });
  const j = await res.json(); if (!j.access_token) throw new Error("cafe24 refresh 실패");
  await sb.from("kv_store").upsert({ key: "cafe24_refresh_token", data: { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + 110 * 60 * 1000 }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return j.access_token;
}

// 면세점 출고분을 완제품 재고 dutyfreeOut 에 누적 (ref→자체상품코드→product_code, 재고 엔트리 있는 것만)
async function applyDutyfreeOut(sb, items, log) {
  if (!items.length) return { applied: 0, skipped: 0 };
  const BASE = `https://${process.env.CAFE24_MALL_ID}.cafe24api.com`;
  let tk; try { tk = await cafe24Token(sb); } catch (e) { log("  cafe24 토큰 실패 — 완제품 재고차감 스킵: " + e.message); return { applied: 0, skipped: items.length, err: true }; }
  const custom = new Map();
  for (let off = 0, p = 0; p < 30; p++, off += 100) {
    const r = await fetch(`${BASE}/api/v2/admin/products?fields=product_code,custom_product_code&limit=100&offset=${off}`, { headers: { Authorization: `Bearer ${tk}` } });
    const b = (await r.json()).products || [];
    for (const x of b) if (x.custom_product_code) custom.set(x.custom_product_code, x.product_code);
    if (b.length < 100) break;
  }
  const inv = (await kvGet(sb, "paulvice_inventory_v1")) || {};
  // 면세점 자체코드(PVJ/PVOVO 등)가 cafe24 custom_product_code 와 안 맞는 경우용 override 맵.
  // kv `dutyfree_ref_map` = { 면세점ref: 카페24 product_code }.
  const refMap = (await kvGet(sb, "dutyfree_ref_map")) || {};
  const byRef = {};
  for (const it of items) byRef[it.ref] = (byRef[it.ref] || 0) + it.qty;
  let applied = 0; const skip = [];
  for (const [ref, qty] of Object.entries(byRef)) {
    const pc = custom.get(ref) || refMap[ref];   // custom_code 우선, 없으면 override 맵
    if (pc && inv[pc]) { inv[pc].dutyfreeOut = (inv[pc].dutyfreeOut || 0) + qty; applied++; }
    else skip.push(ref);
  }
  if (applied) await kvSet(sb, "paulvice_inventory_v1", inv);
  if (skip.length) log(`  ⚠️완제품 재고 미매핑(dutyfree_ref_map 에 추가 필요): ${skip.join(",")}`);
  return { applied, skipped: skip.length };
}
async function tg(msg) { await require("./telegramRelay").relayText(msg); }
// PDF 첨부 전송 — 직결 재시도 후 실패 시 Vercel 릴레이 폴백. displayName 으로 NFC 파일명 사용.
async function tgDoc(filePath, displayName, caption) {
  return require("./telegramRelay").relayDocument(filePath, caption, displayName, 6);
}

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

  // ④ 드라이브 폴더에 저장 (PDF 경로는 텔레그램 첨부용으로 보존 → 정리는 ⑥ 이후)
  const saved = [];
  let pdfPaths = [];
  if (!DRY) {
    pdfPaths = fs.readdirSync(outDir).filter((f) => /\.pdf$/i.test(f)).map((f) => ({ f, p: path.join(outDir, f), nf: nfc(f), isLotte: nfc(f).includes("롯데") }));
    for (const x of pdfPaths) {
      const dest = x.isLotte ? LOTTE_OUT : SINSEGAE_OUT;
      try { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(x.p, path.join(dest, x.f)); saved.push(x.nf); log(`  저장: ${x.nf} → ${x.isLotte ? "롯데" : "신세계"} 패킹리스트`); }
      catch (e) { log(`  저장 실패 ${x.nf}: ${e.message}`); }
    }
  } else log(`[DRY] PDF 저장 생략`);

  // ⑤ 우체국 송장 발급 + 부자재 박스 차감 + 출고 이력 (멱등: 박스=date+store / 송장=registerSingle dedup)
  let boxMsg = "", invMsg = "";
  const invoiceMsg = [];
  if (!DRY) {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const shipLog = (await kvGet(sb, SHIPLOG_KEY)) || [];
    const supplies = await kvGet(sb, SUPPLIES_KEY);
    const newStores = stores.filter((s) => !shipLog.some((e) => e.date === date && e.store === s));

    // 우체국 송장 발급 (처리한 면세점 박스당 1송장, 받는분=면세점 입고처. registerSingle alreadyRegistered 로 멱등)
    const regiByStore = {};
    for (const s of stores) {
      const rc = RECIPIENTS[s];
      const it = s === "신세계" ? (items.sinsegae || []) : (items.lotte || []);
      const qty = it.reduce((a, i) => a + i.qty, 0);
      if (!rc) { invoiceMsg.push(`${s} 송장: 입고처 미설정`); continue; }
      try {
        const r = await registerSingle(
          { name: rc.name, addr: rc.addr, zip: rc.zip || "", mobile: "", tel: rc.tel, prod: `면세점입고 주얼리 ${qty}점`, color: "", qty: String(qty || 1), order: `DF-${s}-${date}`, seller: "면세점" },
          { reqType: "1", source: "면세점" },
        );
        regiByStore[s] = r.regiNo;
        invoiceMsg.push(`${s} ${r.regiNo}${r.skipped ? "(기존)" : r.test ? "(TEST)" : ""}`);
        log(`  우체국 송장 ${s}: ${r.regiNo}${r.skipped ? " (이미 발급)" : ""}`);
      } catch (e) { invoiceMsg.push(`${s} 송장 발급 실패`); log(`  우체국 송장 ${s} 실패: ${e.message}`); }
    }

    // 부자재 박스 차감
    if (supplies && Array.isArray(supplies)) {
      const box = supplies.find((x) => x.id === "box-dutyfree");
      if (box && newStores.length) {
        const before = box.currentStock;
        box.currentStock = Math.max(0, before - newStores.length);
        await kvSet(sb, SUPPLIES_KEY, supplies);
        boxMsg = `면세점 박스 −${newStores.length} (${before}→${box.currentStock}${before - newStores.length < 0 ? ", ⚠️박스 부족" : ""})`;
      } else if (!newStores.length) boxMsg = "박스 차감: 이미 처리됨(멱등 스킵)";
    } else { boxMsg = "⚠️ 부자재 미초기화(대시보드 1회 열어 시드 필요) — 박스 미차감"; }

    // 출고 이력 적재 (송장번호 포함) + 완제품 재고 차감용 품목 수집
    const newItems = [];
    for (const s of newStores) {
      const it = s === "신세계" ? (items.sinsegae || []) : (items.lotte || []);
      newItems.push(...it);
      shipLog.push({ date, store: s, boxes: 1, itemCount: it.length, qty: it.reduce((a, i) => a + i.qty, 0), regiNo: regiByStore[s] || null, items: it, at: new Date().toISOString() });
    }
    if (newStores.length) await kvSet(sb, SHIPLOG_KEY, shipLog);

    // 완제품 재고 차감 (면세점 출고분 dutyfreeOut)
    if (newItems.length) {
      const r = await applyDutyfreeOut(sb, newItems, log);
      invMsg = `완제품 재고 차감 ${r.applied}품목${r.skipped ? ` (면세점전용/미추적 ${r.skipped} 제외)` : ""}`;
      log("  " + invMsg);
    }
  } else boxMsg = "[DRY] 박스 미차감 / 송장 미발급";
  log("  " + boxMsg);

  // ⑥ 텔레그램: 요약 + PDF 첨부(인쇄용)
  const lines = ["📦 면세점 발주 처리 (출고일 " + date.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3") + ")"];
  if (ss) lines.push(`• 신세계: ${ssN}품목 / ${ssQ}pcs`);
  if (lt) lines.push(`• 롯데: ${ltN}품목 / ${ltQ}pcs`);
  if (saved.length) lines.push(`• 서류 ${saved.length}건 생성·드라이브 저장 (아래 첨부 — 인쇄용)`);
  if (invoiceMsg.length) lines.push(`• 🏷️ 우체국 송장: ${invoiceMsg.join(" / ")}`);
  lines.push(`• ${boxMsg}`);
  if (invMsg) lines.push(`• ${invMsg}`);
  await tg(lines.join("\n"));
  // 첨부: 패킹리스트 → 박스라벨 → 거래명세서 순으로 정렬
  const order = (n) => (/패킹리스트/.test(n) ? 0 : /부착/.test(n) ? 1 : 2);
  const sortedPdfs = [...pdfPaths].sort((a, b) => order(a.nf) - order(b.nf));
  for (let i = 0; i < sortedPdfs.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000)); // 연속 전송 레이트리밋/단절 회피
    const x = sortedPdfs[i];
    const ok = await tgDoc(x.p, x.nf, x.nf.replace(/\.pdf$/i, ""));
    log(`  텔레그램 첨부 ${ok ? "✓" : "실패"}: ${x.nf}`);
  }
  if (!DRY && fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  log("완료");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
