/** 일회성 리마인더 등록. 사용: node pvReminderAdd.js <label> <YYYY-MM-DD> <HH:MM>
 *
 * pv_reminders.json 에 <label> 메시지가 있어야 하고, launchd 잡을 설치한다.
 * 발송·정리는 pvReminder.js 가 한다(전송 성공해야 잡 정리, 실패 시 +30분 재무장).
 *
 * ⚠️ StartCalendarInterval 에 <b>Month 까지</b> 박는다.
 *    Day 만 넣으면 매달 같은 날 다시 뜬다 — 8/5 조선몰 건이 이 형태였다.
 *
 * 목록/삭제: node pvReminderAdd.js --list | --rm <label>
 */
const fs = require("fs");
const { execFileSync } = require("child_process");

const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
const STORE = `${DASH}/local-agent/pv_reminders.json`;
const LA = `${process.env.HOME}/Library/LaunchAgents`;
const jobName = (label) => `com.paulvice.reminder-${label}`;
const plistPath = (label) => `${LA}/${jobName(label)}.plist`;

const bootout = (label) => {
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${jobName(label)}`], { stdio: "ignore" });
  } catch {}
};

if (process.argv[2] === "--list") {
  const jobs = fs.readdirSync(LA).filter((f) => f.startsWith("com.paulvice.reminder-"));
  if (!jobs.length) return console.log("등록된 리마인더 없음");
  for (const f of jobs) {
    const x = fs.readFileSync(`${LA}/${f}`, "utf8");
    const g = (k) => (x.match(new RegExp(`<key>${k}</key><integer>(\\d+)</integer>`)) || [])[1];
    const label = f.replace("com.paulvice.reminder-", "").replace(".plist", "");
    console.log(`${label.padEnd(20)} ${g("Month") || "??"}/${g("Day")} ${String(g("Hour")).padStart(2, "0")}:${String(g("Minute")).padStart(2, "0")}`);
  }
  return;
}

if (process.argv[2] === "--rm") {
  const label = process.argv[3];
  bootout(label);
  try { fs.unlinkSync(plistPath(label)); } catch {}
  return console.log("삭제:", label);
}

const [label, date, time] = process.argv.slice(2);
if (!label || !date || !time) {
  console.error("사용: node pvReminderAdd.js <label> <YYYY-MM-DD> <HH:MM>");
  process.exit(1);
}

const msgs = JSON.parse(fs.readFileSync(STORE, "utf8"));
if (!msgs[label]) {
  console.error(`pv_reminders.json 에 "${label}" 메시지가 없습니다. 먼저 추가하세요.`);
  process.exit(1);
}

const [, mo, da] = date.match(/^(\d{4})-(\d{2})-(\d{2})$/) ? [null, +date.slice(5, 7), +date.slice(8, 10)] : [];
const [hh, mi] = time.split(":").map(Number);
if (!mo || !da || Number.isNaN(hh) || Number.isNaN(mi)) {
  console.error("날짜/시각 형식: YYYY-MM-DD HH:MM");
  process.exit(1);
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${jobName(label)}</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>pvReminder.js</string><string>${label}</string></array>
<key>WorkingDirectory</key><string>${DASH}/local-agent</string>
<key>StartCalendarInterval</key><dict><key>Month</key><integer>${mo}</integer><key>Day</key><integer>${da}</integer><key>Hour</key><integer>${hh}</integer><key>Minute</key><integer>${mi}</integer></dict>
<key>StandardErrorPath</key><string>/tmp/pv_reminder_${label}.err</string>
<key>StandardOutPath</key><string>/tmp/pv_reminder_${label}.out</string>
<key>RunAtLoad</key><false/>
</dict></plist>`;

bootout(label);
fs.writeFileSync(plistPath(label), plist);
execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath(label)], { stdio: "ignore" });
console.log(`✓ ${label} — ${mo}/${da} ${String(hh).padStart(2, "0")}:${String(mi).padStart(2, "0")} 등록`);
