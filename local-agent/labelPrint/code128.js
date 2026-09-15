/**
 * Code 128 (subset B/C 자동) 인코더 — 바(검정)/스페이스 폭 배열을 돌려준다. 외부 의존성 없음.
 * 우체국 등기번호(13자리 숫자)는 subset C 로 짝수 자리씩 묶여 가장 짧게 나온다.
 * 검증: 표준 패턴표(ISO/IEC 15417). 체크섬 = (start + Σ value_i × i) mod 103.
 */
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

/** 문자열 → 코드값 배열(스타트 포함, 체크섬·스톱 제외) */
function encodeValues(text) {
  const vals = [];
  let i = 0, mode = null;
  const digitsAhead = (p) => { let n = 0; while (p + n < text.length && /\d/.test(text[p + n])) n++; return n; };
  while (i < text.length) {
    const d = digitsAhead(i);
    if (d >= 4 || (d >= 2 && i + d === text.length)) {
      if (mode !== "C") { vals.push(mode === null ? START_C : CODE_C); mode = "C"; }
      const pairs = Math.floor(d / 2);
      for (let k = 0; k < pairs; k++) { vals.push(Number(text.substr(i, 2))); i += 2; }
      continue;
    }
    if (mode !== "B") { vals.push(mode === null ? START_B : CODE_B); mode = "B"; }
    const ch = text.charCodeAt(i);
    if (ch < 32 || ch > 126) throw new Error(`Code128B 범위 밖 문자: ${text[i]}`);
    vals.push(ch - 32); i++;
  }
  return vals;
}

/** 문자열 → 모듈 폭 배열 [{bar:true,w:2},{bar:false,w:1},…] (마지막 종료 바 포함) */
function code128Modules(text) {
  const vals = encodeValues(String(text));
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, STOP);
  const out = [];
  for (const v of vals) {
    const p = PATTERNS[v];
    for (let k = 0; k < p.length; k++) out.push({ bar: k % 2 === 0, w: Number(p[k]) });
  }
  return out;
}

module.exports = { code128Modules, encodeValues };
