/**
 * Meshy 이미지→3D — 참고 이미지 한 장으로 3D 모델 생성(형태 직접 반영).
 * 사용: node meshyImg.js <이미지경로> [--no-texture]
 * 출력: ~/meshy_models/<stamp_img>/  (model.glb/obj/stl, thumbnail.png)
 */
const fs = require("fs"), path = require("path"), os = require("os");
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

const KEY = process.env.MESHY_API_KEY;
const BASE = "https://api.meshy.ai/openapi";
const log = (m) => console.log(`[meshy-img] ${m}`);
const imgPath = process.argv[2];
const noTex = process.argv.includes("--no-texture");

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
  for (let i = 0; i < 150; i++) {
    const t = await api("GET", `/v1/image-to-3d/${id}`);
    if (t.progress !== last) { log(`  ${t.status} ${t.progress}%`); last = t.progress; }
    if (t.status === "SUCCEEDED") return t;
    if (t.status === "FAILED" || t.status === "CANCELED") throw new Error(`${t.status}: ${JSON.stringify(t.task_error || {})}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("타임아웃");
}
async function download(url, dest) { const r = await fetch(url); if (!r.ok) return 0; const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(dest, b); return b.length; }

(async () => {
  if (!KEY) { log("MESHY_API_KEY 없음"); process.exit(1); }
  if (!imgPath || !fs.existsSync(imgPath)) { log("이미지 경로 필요"); process.exit(1); }
  const ext = path.extname(imgPath).slice(1).toLowerCase().replace("jpg", "jpeg");
  const dataUri = `data:image/${ext};base64,${fs.readFileSync(imgPath).toString("base64")}`;
  const { balance } = await api("GET", "/v1/balance").catch(() => ({ balance: "?" }));
  log(`크레딧 ${balance} | 이미지: ${path.basename(imgPath)}`);

  log("이미지→3D 생성 요청...");
  const created = await api("POST", "/v1/image-to-3d", {
    image_url: dataUri,
    ai_model: "meshy-5",
    topology: "triangle",
    target_polycount: 30000,
    should_remesh: true,
    should_texture: !noTex,
  });
  const id = created.result;
  log(`작업 ID: ${id} → 폴링(보통 1~3분)`);
  const task = await poll(id);

  const slug = path.basename(imgPath, path.extname(imgPath)).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(os.homedir(), "meshy_models", `${stamp}_img_${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  const urls = task.model_urls || {};
  log(`포맷: ${Object.keys(urls).join(", ")}`);
  const saved = [];
  for (const fmt of Object.keys(urls)) { if (!urls[fmt]) continue; const n = await download(urls[fmt], path.join(dir, `model.${fmt}`)); if (n) saved.push(`${fmt}(${(n/1024).toFixed(0)}KB)`); }
  let thumb = ""; if (task.thumbnail_url) { thumb = path.join(dir, "thumbnail.png"); if (!(await download(task.thumbnail_url, thumb))) thumb = ""; }
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ imgPath, id, model_urls: urls, thumbnail_url: task.thumbnail_url }, null, 2));
  log(`✅ 완료 → ${dir}`);
  log(`   저장: ${saved.join(", ")}`);
  console.log(`THUMB=${thumb}`); console.log(`DIR=${dir}`);
})().catch((e) => { console.error("[meshy-img] 오류:", e.message); process.exit(1); });
