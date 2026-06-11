/**
 * 17시 송장입력 (1단계: 세션 독립 채널) — 카페24(API) + 카카오선물(메일 회신).
 * 둘 다 멱등(카페24=배송중 스킵, 카카오=kv 플래그). 매일 launchd 17:10 실행.
 * (29CM·식스샵·무신사·W컨셉은 매출 sync 세션 재사용으로 추후 통합 — 2,3단계)
 */
require("dotenv").config({ override: true });
const { execFile } = require("child_process");
const path = require("path");
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

function run(script, env) {
  return new Promise((resolve) => {
    log(`▶ ${script}`);
    const cp = execFile(process.execPath, [path.join(__dirname, script)], { cwd: __dirname, env: { ...process.env, ...env } });
    let out = "";
    cp.stdout && cp.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    cp.stderr && cp.stderr.on("data", (d) => process.stderr.write(d));
    cp.on("close", (code) => { log(`◀ ${script} (code ${code})`); resolve({ script, code, out }); });
  });
}

async function tg(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: msg }) }).catch(() => {});
}

async function main() {
  log("=== 17시 송장입력 (카페24 + 29CM + 식스샵 + 무신사 + 카카오선물) ===");
  const r1 = await run("cafe24Dispatch.js", { CAFE24_DISPATCH_LIMIT: "50" });
  const r3 = await run("cm29Dispatch.js", {});       // 이메일 자동로그인(SMS X), 멱등
  const r4 = await run("sixshopDispatch.js", {});    // iframe 송장칸, 멱등(이미 송장 스킵), 네이버페이 스킵
  const r5 = await run("musinsaDispatch.js", {});    // 배송출고처리 택배송장일괄입력→출고완료, 멱등(목록서 빠짐)
  const r2 = await run("kakaoGiftReplySend.js", {});
  const c24 = (r1.out.match(/성공 (\d+)/) || [,"?"])[1];
  const cm = /출고처리 시도 완료|✏️/.test(r3.out) ? (r3.out.match(/✏️/g)||[]).length+"건 처리" : (/대상 없음|행수: 0/.test(r3.out) ? "대상없음" : "확인필요");
  const six = r4.out.match(/완료: 성공 (\d+)건\(네이버페이 (\d+)\) \/ 스킵 (\d+)/);
  const sixMsg = six ? `성공 ${six[1]}건${+six[2]?`(네이버페이 ${six[2]})`:""}` : (/대상 없음/.test(r4.out) ? "대상없음" : "확인필요");
  const mu = r5.out.match(/송장입력 완료: 성공 (\d+)/);
  const muMsg = mu ? (+mu[1] ? `성공 ${mu[1]}건` : "대상없음") : (/대상 없음|신규 송장 없음/.test(r5.out) ? "대상없음" : "확인필요");
  const kakao = /카카오 회신 발송/.test(r2.out) ? "발송" : (/스킵|채울 건 없음|메일 없음/.test(r2.out) ? "스킵" : "확인필요");
  await tg(`📮 17시 송장입력\n- 카페24: 성공 ${c24}건\n- 29CM: ${cm}\n- 식스샵: ${sixMsg}\n- 무신사: ${muMsg}\n- 카카오선물: ${kakao}`);
  log("=== 완료 ===");
}

if (require.main === module) {
  main().catch((e) => { console.error("ERR", e); process.exit(1); });
}
