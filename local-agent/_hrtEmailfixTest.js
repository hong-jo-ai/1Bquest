const { chromium } = require("playwright");
const fs = require("fs");
const S = "/private/tmp/claude-501/-Users-mac-sungjo-ai-paulwise-dashboard/54be6538-c6df-445f-b2a2-eec1f56fc0c5/scratchpad/";
const NEW = fs.readFileSync("/Users/mac/sungjo_ai/paulwise-dashboard/downloads/hrt-orderform-emailfix.js", "utf8");

// 카페24 주문서 이메일 행 최소 재현 (A: 정상 구조 / B: 구조 다름 = oemail2 없음)
const HTML = `<!doctype html><meta charset="utf-8"><body>
<table><tr class="ec-orderform-emailRow"><th>E-mail <span>Required</span></th><td>
  <div class="ec-base-mail" id="wrapA">
    <input id="oemail1" name="oemail1" class="mailId" type="text" value="">
    @ <input id="oemail2" name="oemail2" class="mailAddress" type="text" value="">
  </div></td></tr></table>
<table><tr><th>E-mail(회원)</th><td>
  <div class="ec-base-mail" id="wrapB">
    <input id="oemail1b" name="oemail1" class="mailId" type="text" value="peter">
  </div></td></tr></table>
</body>`;
fs.writeFileSync(S + "emailfix-harness.html", HTML);

(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage();
  await p.goto("file://" + S + "emailfix-harness.html");
  await p.evaluate(NEW);
  await p.waitForTimeout(400);

  const r1 = await p.evaluate(() => {
    const w = document.getElementById("wrapA");
    return { 박스: w.querySelectorAll(".pv-email-box").length,
             oemail1: getComputedStyle(document.getElementById("oemail1")).display,
             oemail2: getComputedStyle(document.getElementById("oemail2")).display };
  });
  console.log("A(정상 구조):", JSON.stringify(r1),
    r1.박스 === 1 && r1.oemail1 === "none" ? "→ ✅ 박스 삽입 + 기본칸 숨김" : "→ ❌");

  const r2 = await p.evaluate(() => {
    const w = document.getElementById("wrapB");
    return { 박스: w.querySelectorAll(".pv-email-box").length,
             기본칸: getComputedStyle(document.getElementById("oemail1b")).display };
  });
  console.log("B(구조 다름):", JSON.stringify(r2),
    r2.박스 === 0 && r2.기본칸 !== "none" ? "→ ✅ 페일오픈(기본 입력칸 그대로 노출 = 주문 가능)" : "→ ❌ 또 막힘");

  const box = await p.$("#wrapA .pv-email-box");
  await box.click(); await box.type("peter.hwang@gmail.com", { delay: 15 }); await p.keyboard.press("Tab");
  await p.waitForTimeout(300);
  const r3 = await p.evaluate(() => ({ o1: document.getElementById("oemail1").value, o2: document.getElementById("oemail2").value }));
  console.log("동기화:", JSON.stringify(r3), r3.o1 === "peter.hwang" && r3.o2 === "gmail.com" ? "→ ✅" : "→ ❌");

  console.log("전역 CSS 주입 여부:", await p.evaluate(() => !!document.getElementById("pv-emailfix-css")), "(false 여야 정상)");
  await b.close();
})().catch(e => { console.error("ERR", e.message.slice(0,300)); process.exit(1); });
