/**
 * 카카오톡 대화 내보내기 자동화 — /today 보드의 카톡 항목 원천.
 *
 *   node kakaoExport.js [--dry] [--keep 3]
 *
 * 열려 있는 카카오톡 채팅방 창을 순회하며 "채팅방 설정 → 대화 내용 관리 →
 * 텍스트 파일로 저장"을 눌러 CSV 를 뽑고, ~/KakaoExports 로 모은 뒤
 * kakaoDigest.js 를 이어서 돌린다.
 *
 * ── 왜 이런 구조인가 (실측 2026-08-28) ─────────────────────────────────────
 * · 카카오톡 로컬 DB 는 통짜 암호화(SQLite 헤더 없음)라 직접 못 읽는다.
 * · 앱이 AppleScript 사전을 제공하지 않고 커스텀 UI 라 버튼이 AX 에 거의 안
 *   잡힌다 → 설정 창은 상대좌표 클릭, 저장 패널부터는 표준 AX.
 * · tmux 안에서는 AppleEvent 가 -1712 로 죽는다 → ssh localhost 로 우회한다.
 * · 저장 패널은 늘 "다운로드"로 열린다(폴더를 기억하지 않음) → 여기서 옮긴다.
 * · 카톡은 파일을 정상 저장하고도 "내보내기 중 오류" 창을 띄운다 → 성공 판정은
 *   대화상자가 아니라 실제 파일 생성 여부로 한다.
 *
 * 내보낼 방은 "카카오톡에 창이 열려 있는 방"이다. 사장님이 창을 열어두는 것으로
 * 대상을 고른다 — 목록을 코드에 박으면 방 이름이 바뀔 때마다 조용히 멈춘다.
 */
const fs = require("fs"), path = require("path"), os = require("os");
const { execFileSync } = require("child_process");
const { beat } = require("./heartbeat");

const HOME    = os.homedir();
const EXPORTS = path.join(HOME, "KakaoExports");
const INBOX   = path.join(HOME, "Downloads");
const SCRIPT  = "/Users/mac/sungjo_ai/paulwise-dashboard/local-agent/kakao/exportRooms.applescript";
const PATTERN = /^KakaoTalk_Chat_(.+)_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/;

const args = process.argv.slice(2);
const DRY  = args.includes("--dry");
const KEEP = (() => { const i = args.indexOf("--keep"); const v = i >= 0 ? Number(args[i+1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 2; })();

const listCsv = (dir) => { try { return fs.readdirSync(dir).filter((f) => PATTERN.test(f)); } catch { return []; } };
/**
 * 방 이름. 반드시 NFC 로 정규화한다 — macOS 는 카톡이 저장한 파일명을 NFD(자모 분해)로
 * 돌려주는데, 손으로 옮긴 파일은 NFC 라 같은 방이 둘로 갈린다(실측: 길이 30 vs 16).
 */
const roomOf  = (f) => ((f.match(PATTERN) || [])[1] || f).normalize("NFC");

/** tmux 밖 GUI 세션에서 osascript 실행. localhost ssh 가 유일하게 통하는 경로다. */
function runInGui(scriptPath) {
  return execFileSync("/usr/bin/ssh", ["-o", "BatchMode=yes", "localhost", `/usr/bin/osascript ${JSON.stringify(scriptPath)}`],
    { encoding: "utf8", timeout: 10 * 60_000 });
}

/** 방마다 최신 KEEP 개만 남기고 지운다. 매 실행이 새 타임스탬프 파일을 만들어 무한히 쌓인다. */
function dedupe() {
  const byRoom = new Map();
  for (const f of listCsv(EXPORTS)) {
    const r = roomOf(f);
    if (!byRoom.has(r)) byRoom.set(r, []);
    byRoom.get(r).push({ f, m: fs.statSync(path.join(EXPORTS, f)).mtimeMs });
  }
  const removed = [];
  for (const [, files] of byRoom) {
    files.sort((a, b) => b.m - a.m);
    for (const { f } of files.slice(KEEP)) {
      if (!DRY) fs.unlinkSync(path.join(EXPORTS, f));
      removed.push(f);
    }
  }
  return removed;
}

(async () => {
  fs.mkdirSync(EXPORTS, { recursive: true });
  const before = new Set(listCsv(INBOX));

  console.log("채팅방 내보내기 시작…");
  let uiLog = "";
  try { uiLog = runInGui(SCRIPT).trim(); }
  catch (e) { throw new Error(`UI 자동화 실패: ${(e.stderr || e.message || "").toString().slice(0, 300)}`); }
  if (uiLog) console.log(uiLog.split("\n").map((l) => "  " + l).join("\n"));

  // 성공 판정: 대화상자가 아니라 실제로 생긴 파일로 센다.
  const fresh = listCsv(INBOX).filter((f) => !before.has(f));
  const moved = [];
  for (const f of fresh) {
    const dest = path.join(EXPORTS, f);
    if (!DRY) fs.renameSync(path.join(INBOX, f), dest);
    moved.push(f);
  }
  console.log(`새로 내보낸 파일 ${moved.length}개`);
  for (const f of moved) console.log(`  · ${roomOf(f)}`);

  const removed = dedupe();
  if (removed.length) console.log(`오래된 사본 ${removed.length}개 ${DRY ? "(dry)" : "삭제"}`);

  if (moved.length === 0) {
    console.log("내보낸 파일이 없다 — 채팅방 창이 열려 있는지, 화면이 잠기지 않았는지 확인 필요");
    if (!DRY) await beat("kakao-export", { exported: 0, warn: "no-files" });
    return;
  }

  if (DRY) { console.log("--dry: 요약 생략"); return; }

  console.log("\n요약 실행…");
  const digest = execFileSync(process.execPath, [path.join(__dirname, "kakaoDigest.js"), "--days", "2"],
    { encoding: "utf8", timeout: 10 * 60_000 });
  console.log(digest.trim().split("\n").map((l) => "  " + l).join("\n"));

  await beat("kakao-export", { exported: moved.length });
})().catch(async (e) => {
  console.error("[kakaoExport]", e.message);
  process.exit(1);
});
