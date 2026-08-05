/** 일회성 텔레그램 리마인더. 인자: <label>. 메시지=pv_reminders.json[label].
 *
 * 전송에 성공해야만 자기 launchd 잡을 정리한다. 실패하면 30분 뒤 다시 쏘도록 스스로 재무장.
 * (2026-08-05 조선몰 리마인더가 `fetch failed` 한 번에 통째 유실 — 재시도도 알림도 없었고,
 *  plist 는 Day 만 잡혀 있어 다음 재시도가 한 달 뒤였다. 게다가 응답을 안 보고 정리해서
 *  HTTP 4xx 여도 잡을 지웠다. 그래서 3중 방어를 넣는다:
 *    ① sendTelegram = 직결 3회 백오프 → Vercel 릴레이 폴백
 *    ② 그래도 실패하면 +30분 재무장 (최대 MAX_REARM 회 ≈ 6시간)
 *    ③ 재무장 한도까지 소진하면 notifyFail 로 "못 보냈다"는 사실이라도 경보)
 */
const fs = require("fs");
const { execFileSync } = require("child_process");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(DASH+"/local-agent/.env"); le(DASH+"/.env.local"); le(DASH+"/.env.supabase");

const { sendTelegram, notifyFail } = require("./notifyFail");

const label = process.argv[2];
const MAX_REARM = 12;        // 30분 간격 × 12 ≈ 6시간
const REARM_DELAY_MIN = 30;
const JOB = `com.paulvice.reminder-${label}`;
const PLIST = `${process.env.HOME}/Library/LaunchAgents/${JOB}.plist`;
const ATTEMPTS = `/tmp/pv_reminder_${label}.attempts`;

const msgs = JSON.parse(fs.readFileSync(DASH+"/local-agent/pv_reminders.json","utf8"));
const msg = msgs[label] || ("리마인더: "+label);

const readAttempts = () => { try { return parseInt(fs.readFileSync(ATTEMPTS,"utf8"),10) || 0; } catch { return 0; } };
const bootout = () => { try { execFileSync("launchctl",["bootout",`gui/${process.getuid()}/${JOB}`],{stdio:"ignore"}); } catch {} };

/** launchd 잡·상태파일 제거 (전송 성공 또는 최종 포기 시). */
function cleanup() {
  bootout();
  try { fs.unlinkSync(PLIST); } catch {}
  try { fs.unlinkSync(ATTEMPTS); } catch {}
}

/** +REARM_DELAY_MIN 분 뒤 한 번 더 뜨도록 plist 를 다시 쓴다. Month 까지 박아 다음 달 오발송을 막는다. */
function rearm(n) {
  const at = new Date(Date.now() + REARM_DELAY_MIN * 60 * 1000);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${JOB}</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>pvReminder.js</string><string>${label}</string></array>
<key>WorkingDirectory</key><string>${DASH}/local-agent</string>
<key>StartCalendarInterval</key><dict><key>Month</key><integer>${at.getMonth()+1}</integer><key>Day</key><integer>${at.getDate()}</integer><key>Hour</key><integer>${at.getHours()}</integer><key>Minute</key><integer>${at.getMinutes()}</integer></dict>
<key>StandardErrorPath</key><string>/tmp/pv_reminder_${label}.err</string>
<key>StandardOutPath</key><string>/tmp/pv_reminder_${label}.out</string>
<key>RunAtLoad</key><false/>
</dict></plist>`;
  fs.writeFileSync(ATTEMPTS, String(n));
  bootout();
  fs.writeFileSync(PLIST, plist);
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST], { stdio: "ignore" });
  console.log(`재무장 ${n}/${MAX_REARM}: ${at.toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} 재시도 예약`);
}

(async () => {
  const ok = await sendTelegram(msg, { parseMode: "HTML", tag: `reminder:${label}` });
  if (ok) { cleanup(); console.log("발송·정리:", label); return; }

  const n = readAttempts() + 1;
  if (n <= MAX_REARM) { rearm(n); process.exit(1); }

  // 한도 소진 — 리마인더 본문은 못 보냈지만 "못 보냈다"는 사실만이라도 알린다.
  await notifyFail(`리마인더 발송 실패: ${label}`,
    `${MAX_REARM}회 재시도(직결+릴레이) 모두 실패. pv_reminders.json["${label}"] 내용을 직접 확인하세요.`);
  cleanup();
  console.error("최종 포기:", label);
  process.exit(1);
})().catch(e => { console.error("ERR", (e && e.message || e).toString().slice(0,120)); process.exit(1); });
