/**
 * 17시 송장입력 (1단계: 세션 독립 채널) — 카페24(API) + 카카오선물(메일 회신).
 * 둘 다 멱등(카페24=배송중 스킵, 카카오=kv 플래그). 매일 launchd 17:10 실행.
 * (29CM·식스샵·무신사·W컨셉은 매출 sync 세션 재사용으로 추후 통합 — 2,3단계)
 */
require("dotenv").config({ override: true });
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const DASH = path.resolve(__dirname, "..");
function loadEnv(p) { try { for (const l of fs.readFileSync(p, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue; let v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; } } catch {} }
loadEnv(path.join(DASH, ".env.supabase")); loadEnv(path.join(DASH, ".env.local"));
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

// 발송보류(held) — 최근 3일, 송장입력에서 제외된 건 요약
async function heldSummary() {
  try {
    const { createClient } = require(path.join(DASH, "node_modules/@supabase/supabase-js"));
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const since = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data } = await sb.from("pp_shipments").select("recipient_name,channel").eq("status", "held").gte("created_at", since);
    if (!data || !data.length) return "";
    const names = [...new Set(data.map((r) => r.recipient_name).filter(Boolean))];
    return `\n🔒 발송보류 ${data.length}건 제외: ${names.slice(0, 8).join(", ")}${names.length > 8 ? " 외" : ""}`;
  } catch { return ""; }
}

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
  await require("./telegramRelay").relayText(msg);
}

async function main() {
  log("=== 17시 송장입력 (카페24 + 29CM + 식스샵 + 무신사 + 카카오선물) ===");
  const r1 = await run("cafe24Dispatch.js", { CAFE24_DISPATCH_LIMIT: "300" }); // 옛 'submitted' 누적 + 주말백로그 대비(최신순 정렬과 함께)
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
  const held = await heldSummary();
  await tg(`📮 17시 송장입력\n- 카페24: 성공 ${c24}건\n- 29CM: ${cm}\n- 식스샵: ${sixMsg}\n- 무신사: ${muMsg}\n- 카카오선물: ${kakao}${held}`);
  await require("./heartbeat").beat("dispatch17");
  log("=== 완료 ===");
}

if (require.main === module) {
  main().catch(async (e) => { console.error("ERR", e); try { await require("./notifyFail").notifyFail("17시 송장입력(dispatch17)", e && e.message ? e.message : String(e)); } catch (_) {} process.exit(1); });
}
