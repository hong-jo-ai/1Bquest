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
const { beat } = require("./heartbeat");
const { relayText } = require("./telegramRelay");

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

// ⚠️ 직결(api.telegram.org)로 보내지 말 것 — 아이맥에서 자주 ETIMEDOUT 된다.
//    2026-09-16 실측: 같은 장비에서 curl 과 코어 https(family:4) 는 302 로 붙는데
//    전역 fetch(undici)만 100% 실패했다. 그래서 공용 헬퍼 relayText 를 쓴다
//    (직결 1회 → 실패 시 Vercel 릴레이 폴백).
//    이 함수가 직결이었던 탓에 9/14~9/16 해리엇 SFTP 비번 만료 알림이 조용히 사라졌다.
//    감지 자체는 정상이었다(실패 시 하트비트를 안 찍어 워치독이 브리핑에 띄웠다) — 푸시만 못 갔다.
async function notify(text) {
  const ok = await relayText(text);
  if (!ok) console.log("텔레그램 전송 실패 — 직결·릴레이 모두 실패");
}

(async () => {
  const verbose = process.argv.includes("--verbose");
  const rs = [];
  for (const t of TARGETS) rs.push(await check(t));
  rs.forEach((r) => { if (verbose || !r.ok) console.log(`${r.ok ? "✅" : "❌"} ${r.name}${r.ok ? "" : " — " + r.error}`); });
  const bad = rs.filter((r) => !r.ok);
  if (bad.length) {
    await notify(`⚠️ 카페24 SFTP 점검 실패\n\n` +
      bad.map((b) => `· ${b.name}: ${b.error}`).join("\n") +
      `\n\n웹사이트 자동 배포가 막힙니다. 인증 실패면 ①몇 분 뒤 재시도(IP 차단) ②그래도 실패면 FTP 사용기간 만료 — 카페24 관리자에서 재활성화 필요.`);
    process.exit(1);
  }
  await beat("sftp-health", { ok: true });   // 정상일 때만 하트비트 — 실패는 위에서 알림+exit 1
  if (verbose) console.log("전부 정상");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
