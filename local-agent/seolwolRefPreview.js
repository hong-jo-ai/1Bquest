/**
 * 설월 상세 — AI 레퍼런스 미리보기 빌더
 *
 * ⚠️ 이 파일이 만드는 결과물은 **절대 실제 상세페이지가 아닙니다.**
 *    downloads/seolwol-detail/refs/ 의 AI 생성 레퍼런스를 config의 컷 자리에 끼워
 *    "촬영이 끝나면 이런 흐름이 된다"를 미리 보는 용도.
 *    시계 이미지는 AI가 창작하지 않는다(브랜드 규칙) — 실제 상세는 실물 촬영본만.
 *
 * 사용: node seolwolRefPreview.js
 * 출력: downloads/seolwol-detail/seolwol-preview-REF.html   (상단에 경고 배너)
 */

const fs = require("fs");
const path = require("path");
const { buildHarriotDetail } = require("./hrtDetailBuilder");

const OUT_DIR = path.join(__dirname, "..", "downloads", "seolwol-detail");
const REF_DIR = path.join(OUT_DIR, "refs");

// refs/{studio,self}/cutNN_*.png → { "01": "refs/studio/cut01_dial-hero.png", ... }
function refMap() {
  const map = {};
  for (const group of ["studio", "self", "world"]) {
    const dir = path.join(REF_DIR, group);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = /^cut(\d{2}|AI)_/.exec(f);
      if (m) map[m[1]] = `refs/${group}/${f}`;
    }
  }
  return map;
}

/** config를 깊은 복사하며 image.cut 에 해당하는 레퍼런스 src를 꽂는다. */
function injectRefs(node, map, stat) {
  if (Array.isArray(node)) return node.map((n) => injectRefs(n, map, stat));
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = injectRefs(v, map, stat);
    if (out.cut && !out.src && map[out.cut]) {
      out.src = map[out.cut];
      stat.filled++;
    } else if (out.cut && !out.src) {
      stat.missing.push(out.cut);
    }
    return out;
  }
  return node;
}

const BANNER = `<div style="position:sticky;top:0;z-index:99;background:#7f1d1d;color:#fff;font-family:'Noto Sans KR',sans-serif;font-size:13px;line-height:1.7;padding:14px 20px;text-align:center;letter-spacing:.01em;">
  <b>AI 레퍼런스 · 실제 촬영본 아님</b> — 시계의 다이얼 · 문페이즈 창 · 로고 · 각인은 모두 부정확합니다.<br>
  구도 · 조명 · 프레이밍 · 흐름을 보기 위한 용도이며, 이 이미지는 상세페이지에 <b>절대 사용하지 않습니다.</b>
</div>`;

const config = require("./seolwolDetailConfig");
const map = refMap();
const stat = { filled: 0, missing: [] };
const refConfig = injectRefs(config, map, stat);

const html = buildHarriotDetail(refConfig);
const out = path.join(OUT_DIR, "seolwol-preview-REF.html");
fs.writeFileSync(
  out,
  `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>설월 상세 — AI 레퍼런스 미리보기</title>
<style>body{margin:0;background:#e8eaee;}</style></head><body>${BANNER}${html}</body></html>`
);

console.log(`✓ 레퍼런스 ${stat.filled}컷 반영` + (stat.missing.length ? ` · 미생성 ${stat.missing.join(",")}` : ""));
console.log(`  ${out}`);
