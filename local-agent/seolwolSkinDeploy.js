/**
 * 설월 출시 스킨 배포 — 2026-09-10 09:35 KST 수동 실행.
 *
 * 바꾸는 것 4가지 × 국문(skin4)·영문(skin5) = 파일 8개 / 치환 10곳
 *   ① 히어로 버튼   products/page1/a1.html            → 상품페이지로
 *   ② PC GNB        roma/RM_HEADER/135329/header637a2.html  (HTML + JS 주입 **2곳**)
 *   ③ 모바일 메뉴   roma/RM_SIDEMENU/RM_sidebar6.html (PC 와 별개 파일 — 빠뜨리면 모바일만 인트로行)
 *   ④ 인트로 게이트 layout/basic/main.html            → 블록 삭제(주석만 남김)
 *
 * 파일은 downloads/skin-backup/seolwol-launch-20260910/{orig,new}/ 에 이미 준비돼 있다.
 * SFTP 가 ECONNRESET 이 잦아 **한 연결에서 순차로** 올리고 각 건마다 stat 으로 확인한다.
 *
 * 사용:  node seolwolSkinDeploy.js            # dry-run (올리지 않고 대조만)
 *        node seolwolSkinDeploy.js --go       # 실제 업로드
 *
 * launchd `com.paulvice.seolwol-skin` 이 2026-09-10 09:35 에 --go 로 돌린다.
 * 업로드 후 **양쪽 몰 라이브 페이지를 실제로 받아 4가지를 검증**하고 텔레그램으로 결과를 보낸다.
 * 성공하면 자기 plist 를 .done 으로 옮기고 unload. 실패하면 plist 를 남겨 재시도에 맡긴다.
 */
require("dotenv").config({ path: __dirname + "/.env" });
const Client = require("ssh2-sftp-client");
const fs = require("fs"), path = require("path");

const DIR = "/Users/mac/sungjo_ai/paulwise-dashboard/downloads/skin-backup/seolwol-launch-20260910";
const MAP = [
  ["ko_a1.html",      "/skin4/products/page1/a1.html"],
  ["ko_header.html",  "/skin4/roma/RM_HEADER/135329/header637a2.html"],
  ["ko_sidebar.html", "/skin4/roma/RM_SIDEMENU/RM_sidebar6.html"],
  ["ko_main.html",    "/skin4/layout/basic/main.html"],
  ["en_a1.html",      "/skin5/products/page1/a1.html"],
  ["en_header.html",  "/skin5/roma/RM_HEADER/135329/header637a2.html"],
  ["en_sidebar.html", "/skin5/roma/RM_SIDEMENU/RM_sidebar6.html"],
  ["en_main.html",    "/skin5/layout/basic/main.html"],
];
const PLIST = "/Users/mac/Library/LaunchAgents/com.paulvice.seolwol-skin.plist";
const GO = process.argv.includes("--go");
const OPEN_AT = new Date("2026-09-10T09:35:00+09:00");

/** 라이브 페이지를 받아 4가지가 실제로 반영됐는지 본다. */
async function verify() {
  const UA = { "User-Agent": "Mozilla/5.0" };
  const want = [
    ["harriotwatches.co.kr", "/product/detail.html?product_no=136", "구매하기"],
    ["harriotwatches.com", "/shop2/product/detail.html?product_no=136", "Shop SEOLWOL"],
  ];
  const out = [];
  for (const [host, url, btn] of want) {
    try {
      const html = await (await fetch(`https://${host}/`, { headers: UA })).text();
      const chk = {
        "히어로버튼": html.includes(btn) && html.includes(url),
        "GNB": (html.match(new RegExp(url.replace(/[?]/g, "\\?"), "g")) || []).length >= 2,
        "인트로게이트": !/HRT_SNOW_INTRO_GATE[^]{0,40}<script/.test(html) && !html.includes("seolwol/intro.html"),
        "옛인트로링크": !html.includes('href="/seolwol/index.html"'),
      };
      out.push(`${host}\n` + Object.entries(chk).map(([k, v]) => `  ${v ? "✅" : "❌"} ${k}`).join("\n"));
    } catch (e) { out.push(`${host}\n  ⚠ 확인 실패: ${e.message}`); }
  }
  return out.join("\n");
}

(async () => {
  for (const [f] of MAP) {
    const p = path.join(DIR, "new", f);
    if (!fs.existsSync(p)) throw new Error("수정본 없음: " + p);
    const s = fs.readFileSync(p, "utf8");
    if (s.includes('href="/seolwol/index.html"')) throw new Error(`${f}: 인트로 링크가 남아있다`);
    if (/HRT_SNOW_INTRO_GATE(?!\s*제거됨)/.test(s) && f.endsWith("main.html"))
      throw new Error(`${f}: 게이트가 안 지워졌다`);
  }
  console.log(`사전검사 통과 — 파일 ${MAP.length}개`);
  if (!GO) { console.log("dry-run. 실제 업로드는 --go"); return; }
  const now = new Date();
  if (now < OPEN_AT) { console.log(`아직 이르다 (${now.toISOString()}). 종료.`); return; }
  if (now - OPEN_AT > 30 * 864e5) { console.log("목표에서 30일 초과 — 오작동 방지 종료."); return; }

  const c = new Client();
  await c.connect({ host: "ecimg-ftp-c01.cafe24img.com", port: 8006,
    username: "harriotkorea", password: process.env.HARRIOT_SFTP_PW, readyTimeout: 30000 });
  let ok = 0;
  for (const [f, remote] of MAP) {
    try {
      await c.fastPut(path.join(DIR, "new", f), remote);
      const st = await c.stat(remote);
      console.log(`  ↑ ${remote.padEnd(48)} ${Math.round(st.size / 1024)}KB`);
      ok++;
    } catch (e) { console.log(`  ✗ ${remote}  ${e.message.slice(0, 70)}`); }
    await new Promise((r) => setTimeout(r, 800));
  }
  await c.end();
  console.log(`\n업로드 ${ok}/${MAP.length}`);

  await new Promise((r) => setTimeout(r, 8000)); // CDN/캐시 반영 대기
  const report = await verify();
  console.log("\n" + report);
  const allOk = ok === MAP.length && !report.includes("❌") && !report.includes("⚠");
  try {
    await require("./telegramRelay").relayText(
      `설월 스킨 배포 ${allOk ? "완료 ✅" : "확인필요 ⚠"}\n업로드 ${ok}/${MAP.length}\n\n${report}`);
  } catch (e) { console.log("텔레그램 실패(무해):", e.message); }

  if (allOk) {
    try {
      require("child_process").execSync(`launchctl unload ${PLIST}`, { stdio: "ignore" });
      fs.renameSync(PLIST, PLIST + ".done");
      console.log("launchd 잡 해제 — 다시 뜨지 않는다.");
    } catch (e) { console.log("launchd 해제 실패(무해):", e.message); }
  } else {
    console.log("⚠ 검증 미통과 — plist 를 남겨 다음 예약에 재시도한다.");
  }
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
