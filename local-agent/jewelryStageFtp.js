/** 착용샷 업로드용 FTP 스테이징 — 각 상품폴더 upload/model_*.png 를
 *  번호만 이름으로 가진 폴더로 모읍니다.
 *    downloads/jewelry-detail/<상품명폴더>/upload/model_01.png
 *      → downloads/jewelry-detail/_ftp/pv-detail/<번호>/model_01.png
 *  → FTP 의 web/product/ 아래에 _ftp/pv-detail 폴더(또는 그 안의 <번호> 폴더들)를
 *    통째로 올리면 detail.html 경로(.../pv-detail/<번호>/model_0X.png)와 그대로 맞음.
 *  재실행 안전(매번 _ftp 새로 구성). 사용: node jewelryStageFtp.js
 */
const fs = require("fs"), path = require("path");
const DIR = path.resolve(__dirname, "..", "downloads", "jewelry-detail");
const OUT = path.join(DIR, "_ftp", "pv-detail");

fs.rmSync(path.join(DIR, "_ftp"), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let folders = 0, copied = 0, empty = [];
for (const d of fs.readdirSync(DIR).sort()) {
  const fd = path.join(DIR, d);
  if (d.startsWith("_") || !fs.statSync(fd).isDirectory()) continue;
  const no = (d.match(/^(\d+)/) || [])[1];
  if (!no) continue;
  const updir = path.join(fd, "upload");
  const imgs = fs.existsSync(updir)
    ? fs.readdirSync(updir).filter(f => /^model_\d+\.png$/i.test(f) && fs.statSync(path.join(updir, f)).size > 1000)
    : [];
  folders++;
  if (!imgs.length) { empty.push(no + " " + d); continue; }
  const dst = path.join(OUT, no);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of imgs) { fs.copyFileSync(path.join(updir, f), path.join(dst, f)); copied++; }
}

console.log(`스테이징 완료 → ${OUT}`);
console.log(`상품폴더 ${folders} | 복사 이미지 ${copied} | 착용샷 아직 없는 폴더 ${empty.length}`);
if (empty.length) console.log("아직 비어있음(생성 후 재실행):\n  " + empty.join("\n  "));
