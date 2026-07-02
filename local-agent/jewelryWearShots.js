/** paulvice 주얼리 착용샷 일괄 생성 — OpenAI gpt-image-1 image-to-image.
 *  대상: downloads/jewelry-detail/<상품폴더>/  (73종)
 *  입력: source/detail.jpg (실제 제품컷) + prompt.txt 의 [English prompt] 블록 2개.
 *  출력: upload/model_01.png, upload/model_02.png  (detail.html 이 이 경로를 가리킴)
 *  - 이미 있는 결과물은 스킵(재개 가능). source/detail.jpg 없으면 스킵.
 *  - 동시 CONCURRENCY 장 병렬, 호출당 최대 RETRY회 재시도.
 *  사용:  OPENAI_API_KEY=... node jewelryWearShots.js [--quality high|medium|low] [--force] [--only 139,148] [--limit N]
 */
const fs = require("fs"), path = require("path");
const DIR = path.resolve(__dirname, "..", "downloads", "jewelry-detail");

// --- env 로드 (.env 에 OPENAI_API_KEY 넣어두면 자동 사용) ---
function loadEnv(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
loadEnv(path.join(__dirname, ".env"));
loadEnv(path.resolve(__dirname, "..", ".env.local"));

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error("✗ OPENAI_API_KEY 없음. local-agent/.env 에 OPENAI_API_KEY=sk-... 추가하세요."); process.exit(1); }

// --- args ---
const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i+1] : d; };
const QUALITY = getArg("--quality", "high");      // low|medium|high
const SIZE = "1024x1536";                          // 세로 (4:5에 가장 근접)
const FORCE = args.includes("--force");
const ONLY = (getArg("--only", "") || "").split(",").map(s=>s.trim()).filter(Boolean); // 상품번호 prefix
const LIMIT = parseInt(getArg("--limit", "0"), 10) || 0;
const CONCURRENCY = parseInt(getArg("--concurrency", "3"), 10) || 3;
const RETRY = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// source/ 안의 참조 제품컷 찾기 (확장자 무관: detail.* 우선, 없으면 list.*)
function findSource(srcDir) {
  if (!fs.existsSync(srcDir)) return null;
  const files = fs.readdirSync(srcDir);
  const pick = base => files.find(f => new RegExp(`^${base}\\.(jpe?g|png|webp)$`, "i").test(f));
  const f = pick("detail") || pick("list");
  return f ? path.join(srcDir, f) : null;
}
const MIME = { ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp" };

// prompt.txt 에서 (파일명, 영문프롬프트) 쌍 추출
function parsePrompts(txt) {
  const out = [];
  // "저장 파일명: model_0X.png" ... "[English prompt]\n<본문>" (다음 ──── 구분선 또는 EOF 까지)
  const blocks = txt.split(/─{5,}/);
  for (const b of blocks) {
    const fm = b.match(/저장 파일명:\s*(model_\d+\.png)/);
    if (!fm) continue;
    const em = b.match(/\[English prompt\]\s*([\s\S]*?)\s*$/);
    if (!em) continue;
    out.push({ file: fm[1], prompt: em[1].trim() });
  }
  return out;
}

async function genOne(buf, prompt, srcName) {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  const ext = path.extname(srcName || ".jpg").toLowerCase();
  form.append("image", new Blob([buf], { type: MIME[ext] || "image/jpeg" }), "source" + (ext || ".jpg"));
  form.append("prompt", prompt);
  form.append("size", SIZE);
  form.append("quality", QUALITY);
  form.append("input_fidelity", "high");   // 입력 제품 디테일(큐빅·각인 등) 보존
  form.append("n", "1");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
  const j = await res.json();
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("응답에 b64_json 없음: " + JSON.stringify(j).slice(0, 300));
  return Buffer.from(b64, "base64");
}

async function genWithRetry(buf, prompt, tag, srcName) {
  for (let i = 1; i <= RETRY; i++) {
    try { return await genOne(buf, prompt, srcName); }
    catch (e) {
      const msg = String(e.message || e);
      console.warn(`  ⚠ ${tag} 시도 ${i}/${RETRY} 실패: ${msg.slice(0,160)}`);
      if (i === RETRY) throw e;
      await sleep(2000 * i);
    }
  }
}

// 생성할 작업 목록 평탄화
function buildTasks() {
  const dirs = fs.readdirSync(DIR).filter(d => fs.statSync(path.join(DIR, d)).isDirectory()).sort();
  const tasks = [];
  let folders = 0;
  for (const d of dirs) {
    if (d.startsWith("_")) continue;
    const no = (d.match(/^(\d+)/) || [])[1];
    if (ONLY.length && !ONLY.includes(no)) continue;
    const src = findSource(path.join(DIR, d, "source"));
    if (!src) { console.warn(`- ${d}: source 이미지 없음 → 스킵`); continue; }
    const ptxt = path.join(DIR, d, "prompt.txt");
    if (!fs.existsSync(ptxt)) { console.warn(`- ${d}: prompt.txt 없음 → 스킵`); continue; }
    const prompts = parsePrompts(fs.readFileSync(ptxt, "utf8"));
    if (!prompts.length) { console.warn(`- ${d}: 영문 프롬프트 파싱 실패 → 스킵`); continue; }
    const updir = path.join(DIR, d, "upload");
    fs.mkdirSync(updir, { recursive: true });
    folders++;
    for (const p of prompts) {
      const outPath = path.join(updir, p.file);
      if (!FORCE && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) continue; // 이미 있음
      tasks.push({ dir: d, src, prompt: p.prompt, outPath, tag: `${d}/${p.file}` });
    }
  }
  return { tasks, folders };
}

async function main() {
  let { tasks } = buildTasks();
  if (LIMIT) tasks = tasks.slice(0, LIMIT);
  const total = tasks.length;
  console.log(`▶ gpt-image-1 / quality=${QUALITY} / size=${SIZE} / 동시 ${CONCURRENCY}`);
  console.log(`▶ 생성 대상: ${total}장 (이미 있는 건 스킵${FORCE ? ", --force 로 덮어씀" : ""})\n`);
  if (!total) { console.log("생성할 게 없습니다(전부 완료됨)."); return; }

  let done = 0, ok = 0, fail = 0;
  const fails = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      try {
        const buf = fs.readFileSync(t.src);
        const out = await genWithRetry(buf, t.prompt, t.tag, t.src);
        fs.writeFileSync(t.outPath, out);
        ok++; console.log(`✓ [${++done}/${total}] ${t.tag} (${(out.length/1024).toFixed(0)}KB)`);
      } catch (e) {
        fail++; done++; fails.push(t.tag);
        console.error(`✗ [${done}/${total}] ${t.tag}: ${String(e.message||e).slice(0,160)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n완료: 성공 ${ok} / 실패 ${fail} / 총 ${total}`);
  if (fails.length) console.log("실패 목록(재실행하면 자동 재시도):\n  " + fails.join("\n  "));
}

main().catch(e => { console.error("치명적 오류:", e); process.exit(1); });
