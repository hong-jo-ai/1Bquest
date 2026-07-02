/**
 * STL → 슬라이스 (Phase 2) — Meshy 메시를 뱀부 A1 + PLA로 슬라이스해 3mf/gcode 생성.
 *
 * AI 메시는 단위가 제각각 → 모델 최대치수를 목표 mm로 자동 스케일. 방향 자동최적화(--orient).
 *
 * 사용:
 *   node meshySlice.js <model.stl> [--size 45] [--quality 0.20mm Standard]
 *   node meshySlice.js ~/meshy_models/xxx/model.stl --size 50
 *
 * 출력: <stl폴더>/slice/ 에 keychain.3mf + plate_1.gcode, 예상시간·재료 콘솔 출력.
 */
const fs = require("fs"), path = require("path"), cp = require("child_process");

const ORCA = "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer";
const PROF = "/Applications/OrcaSlicer.app/Contents/Resources/profiles/BBL";
const log = (m) => console.log(`[slice] ${m}`);

const args = process.argv.slice(2);
const stl = args.find((a) => !a.startsWith("--") && /\.(stl|obj|3mf)$/i.test(a));
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const TARGET = Number(opt("size", "45"));     // 최대 치수 목표(mm)
const QUALITY = opt("quality", "0.20mm Standard"); // 프로세스 프리셋(품질)
const MACHINE = opt("machine", "Bambu Lab A1 0.4 nozzle");
const FILAMENT = opt("filament", "Bambu PLA Basic @BBL A1");

function run(cmdArgs) {
  const r = cp.spawnSync(ORCA, cmdArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return (r.stdout || "") + (r.stderr || "");
}

if (!stl || !fs.existsSync(stl)) { log("STL 경로 필요: node meshySlice.js <model.stl> [--size 45]"); process.exit(1); }
if (!fs.existsSync(ORCA)) { log("OrcaSlicer 미설치 (/Applications/OrcaSlicer.app)"); process.exit(1); }

// 1) 모델 크기 → 스케일 계산
const info = run(["--info", stl]);
const g = (k) => { const m = info.match(new RegExp(`${k}\\s*=\\s*([\\d.eE+-]+)`)); return m ? Number(m[1]) : null; };
const sx = g("size_x"), sy = g("size_y"), sz = g("size_z");
if (!sx) { log(`크기 정보 못읽음:\n${info.slice(0, 300)}`); process.exit(1); }
const maxDim = Math.max(sx, sy, sz);
const scale = TARGET / maxDim;
log(`원본 ${sx.toFixed(1)}×${sy.toFixed(1)}×${sz.toFixed(1)} → 목표 최대 ${TARGET}mm → 스케일 ×${scale.toFixed(5)}`);
log(`출력 예상 크기: ${(sx * scale).toFixed(1)}×${(sy * scale).toFixed(1)}×${(sz * scale).toFixed(1)} mm`);

// 2) 슬라이스
const outDir = path.join(path.dirname(stl), "slice");
fs.mkdirSync(outDir, { recursive: true });
const name = (QUALITY.includes("A1") ? QUALITY : `${QUALITY} @BBL A1`);
const machineJson = `${PROF}/machine/${MACHINE}.json`;
const processJson = `${PROF}/process/${name}.json`;
const filamentJson = `${PROF}/filament/${FILAMENT}.json`;
for (const [n, p] of [["machine", machineJson], ["process", processJson], ["filament", filamentJson]]) {
  if (!fs.existsSync(p)) { log(`⚠️ ${n} 프로파일 없음: ${p}`); process.exit(1); }
}
log("슬라이스 중...");
const out = run([
  "--load-settings", `${machineJson};${processJson}`,
  "--load-filaments", filamentJson,
  "--scale", String(scale), "--orient", "1", "--arrange", "1", "--slice", "0",
  "--export-3mf", "print.3mf", "--outputdir", outDir,
  stl,
]);

const gcode = path.join(outDir, "plate_1.gcode");
const tmf = path.join(outDir, "print.3mf");
if (!fs.existsSync(gcode)) { log(`슬라이스 실패:\n${out.split("\n").filter((l) => /error|fail|exit/i.test(l)).slice(-6).join("\n")}`); process.exit(1); }

// 3) 예상치 파싱 (시간·레이어=헤더, 필라멘트량=푸터 → 앞+뒤 둘 다 읽음)
const buf = fs.readFileSync(gcode, "utf8");
const head = buf.slice(0, 60000) + "\n" + buf.slice(-40000);
const pick = (re) => { const m = head.match(re); return m ? m[1].trim() : "?"; };
const printTime = pick(/total estimated time:\s*([^\n;]+)/i);
const modelTime = pick(/model printing time:\s*([^\n;]+)/i);
const layers = pick(/total layer number:\s*(\d+)/i);
const filMm = Number(pick(/filament used \[mm\]\s*=\s*([\d.]+)/i)) || 0;
const filCm3 = Number(pick(/filament used \[cm3\]\s*=\s*([\d.]+)/i)) || 0;
const grams = (filCm3 * 1.24).toFixed(1); // PLA 밀도 ~1.24 g/cm3

log(`✅ 슬라이스 완료`);
log(`   3MF: ${tmf}`);
log(`   gcode: ${gcode}`);
log(`   예상 출력시간: ${printTime} (모델 ${modelTime}) · ${layers}레이어`);
log(`   재료: ${filCm3}cm³ ≈ ${grams}g PLA (${(filMm / 1000).toFixed(2)}m)`);
console.log(`TMF=${tmf}`);
console.log(`TIME=${printTime}`);
console.log(`GRAMS=${grams}`);
