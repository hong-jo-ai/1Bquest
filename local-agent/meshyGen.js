/**
 * Meshy.ai 텍스트→3D 생성 (Phase 1) — CAD 없이 프린트용 메시 생성.
 *
 * 3D 프린트는 형상만 필요 → 기본은 프리뷰 메시(텍스처 X, 크레딧 절약). --texture 주면 refine(텍스처).
 *
 * 사용:
 *   node meshyGen.js "a simple keychain charm shaped like a wristwatch, flat base"
 *   node meshyGen.js "..." --style sculpture --texture --polycount 30000
 *
 * 출력: ~/meshy_models/<타임스탬프-슬러그>/  (model.obj/glb, thumbnail.png, meta.json)
 */
const fs = require("fs"), path = require("path"), os = require("os");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const KEY = process.env.MESHY_API_KEY;
const BASE = "https://api.meshy.ai/openapi";
const log = (m) => console.log(`[meshy] ${m}`);

const args = process.argv.slice(2);
const prompt = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a))[0]
  || args.find((a) => !a.startsWith("--"));
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json; try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  return json;
}

async function poll(id) {
  let last = -1;
  for (let i = 0; i < 120; i++) {
    const t = await api("GET", `/v2/text-to-3d/${id}`);
    if (t.progress !== last) { log(`  ${t.status} ${t.progress}%`); last = t.progress; }
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELED") throw new Error(`작업 ${t.status}: ${JSON.stringify(t.task_error || {})}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("타임아웃(10분)");
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

(async () => {
  if (!KEY) { log("MESHY_API_KEY 없음(.env)"); process.exit(1); }
  if (!prompt) { log('프롬프트 필요: node meshyGen.js "object description"'); process.exit(1); }

  log(`프롬프트: "${prompt}"`);
  const { balance } = await api("GET", "/v1/balance").catch(() => ({ balance: "?" }));
  log(`크레딧 잔액: ${balance}`);

  // 1) 프리뷰(형상) 생성
  log("프리뷰 메시 생성 요청...");
  const created = await api("POST", "/v2/text-to-3d", {
    mode: "preview",
    prompt,
    art_style: opt("style", "realistic"),
    should_remesh: true,
    target_polycount: Number(opt("polycount", "30000")),
    ai_model: "meshy-5",
  });
  const previewId = created.result;
  log(`작업 ID: ${previewId} → 폴링(보통 30초~2분)`);
  let task = await poll(previewId);

  // 2) (옵션) 텍스처 refine
  if (flag("texture")) {
    log("텍스처 refine 요청...");
    const ref = await api("POST", "/v2/text-to-3d", { mode: "refine", preview_task_id: previewId });
    task = await poll(ref.result);
  }

  // 출력 폴더
  const slug = prompt.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(os.homedir(), "meshy_models", `${stamp}_${slug}`);
  fs.mkdirSync(dir, { recursive: true });

  const urls = task.model_urls || {};
  log(`다운로드 가능 포맷: ${Object.keys(urls).join(", ") || "(없음)"}`);
  const saved = [];
  for (const fmt of Object.keys(urls)) {
    if (!urls[fmt]) continue;
    const dest = path.join(dir, `model.${fmt}`);
    const n = await download(urls[fmt], dest);
    if (n) { saved.push(`model.${fmt} (${(n / 1024).toFixed(0)}KB)`); }
  }
  let thumb = "";
  if (task.thumbnail_url) { thumb = path.join(dir, "thumbnail.png"); if (!(await download(task.thumbnail_url, thumb))) thumb = ""; }
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ prompt, previewId, status: task.status, model_urls: urls, thumbnail_url: task.thumbnail_url, createdAt: stamp }, null, 2));

  log(`✅ 완료 → ${dir}`);
  log(`   저장: ${saved.join(", ")}`);
  if (thumb) log(`   썸네일: ${thumb}`);
  // 마지막 줄에 썸네일 경로 출력(상위 호출이 사용자에게 전송용)
  console.log(`THUMB=${thumb}`);
  console.log(`DIR=${dir}`);
})().catch((e) => { console.error("[meshy] 오류:", e.message); process.exit(1); });
