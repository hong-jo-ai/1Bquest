/**
 * 카카오 리뷰 알림톡 템플릿 승인 감시 — launchd가 2시간마다 실행.
 * 두 템플릿(해리엇·폴바이스)이 모두 APPROVED 되면 텔레그램 알림 + 자기 launchd 제거(폴링 중단).
 * 재반려(BASELINE 이후 새 반려 코멘트)도 알림 + 제거. INSPECTING 동안은 조용히 대기.
 */
require("dotenv").config({ override: true });
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p){ try { for (const l of fs.readFileSync(p,"utf8").split("\n")){ const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(!m)continue; let v=m[2].trim().replace(/^["']|["']$/g,""); if(!(m[1] in process.env)) process.env[m[1]]=v; } } catch {} }
loadEnv(path.join(DASH,".env.local")); loadEnv(path.join(DASH,"local-agent/.env"));

const TEMPLATES = [
  { brand: "해리엇", id: "KA01TP260630024428944zZsOHo2VyGm" },
  { brand: "폴바이스", id: "KA01TP260630024301065LrzCjEP3cp0" },
];
const BASELINE = "2026-06-30T07:30:00.000Z"; // 이전 반려(06:44)는 무시, 이후 결과만 감지

function auth() {
  const key = process.env.SOLAPI_API_KEY, secret = process.env.SOLAPI_API_SECRET;
  const date = new Date().toISOString(), salt = crypto.randomBytes(16).toString("hex");
  return `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${crypto.createHmac("sha256", secret).update(date + salt).digest("hex")}`;
}
async function relay(msg) { try { await require("./telegramRelay").relayText(msg); } catch (e) { console.error("tg fail", e.message); } }
function selfRemove() {
  try {
    const { execSync } = require("child_process");
    const label = "com.paulvice.review-template-watch";
    execSync(`launchctl bootout gui/$(id -u)/${label} 2>/dev/null; rm -f "${process.env.HOME}/Library/LaunchAgents/${label}.plist"`, { stdio: "ignore" });
  } catch {}
}

(async () => {
  const results = [];
  for (const t of TEMPLATES) {
    const r = await fetch(`https://api.solapi.com/kakao/v2/templates/${t.id}`, { headers: { Authorization: auth() } });
    const j = await r.json().catch(() => ({}));
    const newReject = (j.comments || []).some((c) => c.isAdmin && c.dateCreated > BASELINE);
    results.push({ brand: t.brand, status: j.status, newReject, comment: (j.comments || []).slice(-1)[0]?.content || "" });
  }
  const allApproved = results.every((r) => r.status === "APPROVED");
  const anyNewReject = results.some((r) => r.status === "REJECTED" && r.newReject);

  if (allApproved) {
    await relay("✅ 카카오 리뷰 알림톡 템플릿 *승인 완료* (해리엇·폴바이스)\n이제 리뷰요청을 알림톡으로 켤 수 있습니다.\n클로드에게 \"리뷰 알림톡 켜줘\" 하시면 env 세팅·배포·테스트까지 이어서 진행합니다.");
    selfRemove();
    console.log("APPROVED → 알림 발송 + 감시 종료");
  } else if (anyNewReject) {
    const rej = results.find((r) => r.status === "REJECTED" && r.newReject);
    await relay(`⚠️ 카카오 리뷰 템플릿 *재반려* (${rej.brand})\n사유: ${rej.comment.slice(0, 200)}\n클로드에게 알려주시면 문구 다시 고쳐 재제출하겠습니다.`);
    selfRemove();
    console.log("재반려 → 알림 발송 + 감시 종료");
  } else {
    console.log("대기 중:", results.map((r) => `${r.brand}=${r.status}`).join(", "));
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
