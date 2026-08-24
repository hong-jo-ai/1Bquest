/**
 * 카페24 SFTP 헬스체크 (2026-08-24 신설).
 *
 * 왜: 히어로·메인 섹션을 스킨 코드로 옮기면서 **SFTP가 웹사이트 자동화의 단일 장애점**이 됐다.
 *     카페24 FTP 는 사용기간이 주기적으로 만료되고(실측: 08-24 아침 실패 → 저녁 정상),
 *     짧은 시간 연속 인증 실패 시 IP 가 10~30분 차단된다. 배포 직전에 알면 늦으므로 매일 본다.
 *
 * 동작: 접속 → 루트 목록 → skin2/index.html stat 까지 확인. 실패면 텔레그램 알림.
 * 사용: node sftpHealth.js            (조용히 확인, 실패 시에만 알림)
 *       node sftpHealth.js --verbose  (성공도 출력)
 */
require("dotenv").config({ override: true });
const Client = require("ssh2-sftp-client");

const TARGETS = [
  { name: "폴바이스", host: "ecimg-ftp-c01.cafe24img.com", port: 8007, user: "icaruse2000",
    pw: () => process.env.CAFE24_SFTP_PW, probe: "/skin2/index.html" },
  { name: "해리엇",   host: "ecimg-ftp-c01.cafe24img.com", port: 8006, user: "harriotkorea",
    pw: () => process.env.HARRIOT_SFTP_PW, probe: "/" },
];

async function check(t) {
  const pw = t.pw();
  if (!pw) return { name: t.name, ok: false, error: "비밀번호 환경변수 없음" };
  const s = new Client();
  try {
    await s.connect({ host: t.host, port: t.port, username: t.user, password: pw, readyTimeout: 25000 });
    if (t.probe === "/") await s.list("/");
    else await s.stat(t.probe);
    return { name: t.name, ok: true };
  } catch (e) {
    return { name: t.name, ok: false, error: e.message };
  } finally { await s.end().catch(() => {}); }
}

async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return console.log("(텔레그램 미설정)");
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
  }).catch((e) => console.log("텔레그램 실패:", e.message));
}

(async () => {
  const verbose = process.argv.includes("--verbose");
  const rs = [];
  for (const t of TARGETS) rs.push(await check(t));
  rs.forEach((r) => { if (verbose || !r.ok) console.log(`${r.ok ? "✅" : "❌"} ${r.name}${r.ok ? "" : " — " + r.error}`); });
  const bad = rs.filter((r) => !r.ok);
  if (bad.length) {
    await notify(`⚠️ <b>카페24 SFTP 점검 실패</b>\n\n` +
      bad.map((b) => `· ${b.name}: ${b.error}`).join("\n") +
      `\n\n웹사이트 자동 배포가 막힙니다. 인증 실패면 ①몇 분 뒤 재시도(IP 차단) ②그래도 실패면 FTP 사용기간 만료 — 카페24 관리자에서 재활성화 필요.`);
    process.exit(1);
  }
  if (verbose) console.log("전부 정상");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
