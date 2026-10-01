/**
 * HARRIOT JOURNAL 배포
 *
 *   node harriot-journal/build.js && node harriot-journal/deploy.js
 *   node harriot-journal/deploy.js --dry     (업로드 없이 계획만 출력)
 *
 * dist/<lang>/journal/*.html → 카페24 SFTP <스킨>/journal/*.html
 * 이어서 sitemap.xml 에 저널 URL 을 반영한다(기존 URL 은 보존, 저널 URL 만 교체).
 *
 * ⚠️ 비번은 env HARRIOT_SFTP_PW. 하드코딩 금지(.claude/rules/ops.md)
 * ⚠️ 카페24는 2단계 하위폴더 index.html 을 매핑하지 않는다 → 글은 반드시 flat .html
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
require(path.join(ROOT, "local-agent/node_modules/dotenv"))
  .config({ path: path.join(ROOT, "local-agent/.env"), override: true });
const Client = require(path.join(ROOT, "local-agent/node_modules/ssh2-sftp-client"));

const DRY = process.argv.includes("--dry");
const ORIGIN = "https://harriotwatches.co.kr";
const DIST = path.join(__dirname, "dist");

/** 언어별 배포 대상 스킨 폴더. 영문몰 스킨은 확인 후 채운다. */
const TARGETS = {
  ko: { skin: "/skin4", origin: ORIGIN },
  en: { skin: "/skin5", origin: "https://harriotwatches.com" },
};

const SFTP = { host: "ecimg-ftp-c01.cafe24img.com", port: 8006, username: "harriotkorea" };

function backupDir() {
  const d = path.join(ROOT, "downloads", "harriot-journal-deploy-20260902");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/**
 * 저널 URL 만 담은 독립 사이트맵.
 *
 * 왜 따로 두나 — 카페24가 만드는 기본 `sitemap.xml` 은 **영문몰(skin5)에서도 상품 URL 이
 * 국문 도메인(harriotwatches.co.kr)으로 박혀 있다**(2026-09-05 실측: .com 사이트맵 72개 중
 * 53개가 .co.kr). 그걸 그대로 서치콘솔 `harriotwatches.com` 속성에 제출하면 구글이
 * "이 사이트에 속하지 않는 URL" 로 보고 계속 오류를 띄운다. 저널만 담은 사이트맵을 따로 주면
 * 그 경고 없이 색인된다. 기본 sitemap.xml 은 그대로 두고(상품 색인은 거기서 계속 된다) 하나 더 얹는 것.
 */
function buildJournalSitemap(journalUrls) {
  const body = journalUrls.map((u) =>
    `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** 사이트맵에서 /journal/ URL 만 걷어내고 새 목록으로 갈아끼운다 */
function patchSitemap(xml, journalUrls) {
  const cleaned = xml.replace(
    /\s*<url>\s*<loc>[^<]*\/journal\/[^<]*<\/loc>[\s\S]*?<\/url>/g, "");
  const block = journalUrls.map((u) =>
    `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`
  ).join("\n");
  return cleaned.replace(/<\/urlset>/, block + "\n</urlset>");
}

(async () => {
  const bk = backupDir();

  for (const [lang, target] of Object.entries(TARGETS)) {
    const dist = path.join(DIST, lang, "journal");
    if (!fs.existsSync(dist)) { console.log(`[${lang}] dist 없음 — 스킵`); continue; }
    const files = fs.readdirSync(dist).filter((f) => f.endsWith(".html"));

    const journalUrls = files.map((f) => f === "index.html"
      ? { loc: `${target.origin}/journal/`, freq: "weekly", pri: "0.8" }
      : { loc: `${target.origin}/journal/${f}`, freq: "monthly", pri: "0.7" });

    console.log(`\n[${lang}] ${target.skin}/journal/ ← ${files.length}개`);
    files.forEach((f) => console.log("   " + f));
    console.log(`   sitemap: /journal/ URL ${journalUrls.length}개 반영`);
    if (DRY) continue;

    const c = new Client();
    await c.connect({ ...SFTP, password: process.env.HARRIOT_SFTP_PW, readyTimeout: 25000 });

    try { await c.mkdir(`${target.skin}/journal`, true); } catch (e) {
      if (!/exist/i.test(e.message)) throw e;
    }
    for (const f of files) {
      await c.fastPut(path.join(dist, f), `${target.skin}/journal/${f}`);
      console.log("   ↑ " + f);
    }

    // 사이트맵 갱신
    const smRemote = `${target.skin}/sitemap.xml`;
    const smLocal = path.join(bk, `sitemap_before_${lang}.xml`);
    await c.fastGet(smRemote, smLocal);
    const before = fs.readFileSync(smLocal, "utf8");
    const after = patchSitemap(before, journalUrls);
    const outLocal = path.join(bk, `sitemap_after_${lang}.xml`);
    fs.writeFileSync(outLocal, after);
    await c.fastPut(outLocal, smRemote);
    const n = (s) => (s.match(/<loc>/g) || []).length;
    console.log(`   sitemap ${n(before)} → ${n(after)} URL`);

    // 저널 전용 사이트맵 — 서치콘솔엔 이걸 제출한다(도메인 섞임 경고 회피)
    const jsLocal = path.join(bk, `journal-sitemap_${lang}.xml`);
    fs.writeFileSync(jsLocal, buildJournalSitemap(journalUrls));
    await c.fastPut(jsLocal, `${target.skin}/journal-sitemap.xml`);
    console.log(`   journal-sitemap.xml ${journalUrls.length}개 → ${target.origin}/journal-sitemap.xml`);

    await c.end();
  }
  console.log(DRY ? "\n(dry run — 업로드 안 함)" : "\n배포 완료. 백업 = " + path.relative(ROOT, bk));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
