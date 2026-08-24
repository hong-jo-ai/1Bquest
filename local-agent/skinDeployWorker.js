/**
 * 웹사이트 변경 배포 워커 (아이맥) — 2026-08-24
 *
 * 텔레그램 승인 카드에서 사장님이 [✅ 적용]을 누르면 kv 의 변경안이 approved 로 바뀐다.
 * 이 워커가 그걸 폴링해 **실제 배포**한다(카페24 SFTP 자격증명이 아이맥에만 있으므로).
 * 우체국 접수 큐와 같은 구조 — 프로덕션은 승인만 기록, 실행은 아이맥.
 *
 * 사용: node skinDeployWorker.js            (한 번 처리하고 종료 — 크론/launchd 용)
 *       node skinDeployWorker.js --watch    (60초 간격 상주)
 */
require("dotenv").config({ override: true });
const path = require("path"), fs = require("fs");
const D = require("./skinDeploy");
const { createClient } = require(path.resolve(__dirname, "..", "node_modules/@supabase/supabase-js"));

function loadEnv(p){ try{ for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");} }catch{} }
loadEnv(path.resolve(__dirname, "..", ".env.supabase"));
loadEnv(path.resolve(__dirname, ".env"));

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const INDEX_KEY = "skin:change:index";
const KEY = (id) => `skin:change:${id}`;

async function loadChange(id) {
  const { data } = await sb().from("kv_store").select("data").eq("key", KEY(id)).maybeSingle();
  return data?.data ?? null;
}
async function saveChange(c) {
  await sb().from("kv_store").upsert({ key: KEY(c.id), data: c, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
async function approvedChanges() {
  const { data } = await sb().from("kv_store").select("data").eq("key", INDEX_KEY).maybeSingle();
  const ids = Array.isArray(data?.data) ? data.data : [];
  const out = [];
  for (const id of ids) { const c = await loadChange(id); if (c && c.status === "approved") out.push(c); }
  return out;
}
async function tg(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!t || !chat) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

async function deploy(c) {
  const log = (m) => console.log(`  [${c.id}] ${m}`);
  return D.session(async () => {
    const tag = D.stamp();
    const bk = await D.backupFiles(["/skin2/index.html"], tag);
    log(`백업 → ${bk.dir}`);

    if (c.plan.images?.length) {
      await D.uploadFiles(c.plan.images.map((i) => [i.local, i.remote]));
      log(`이미지 ${c.plan.images.length}개 업로드`);
    }

    let newName = null;
    if (c.plan.section) {
      const { local, remoteDir, base } = c.plan.section;
      const up = await D.uploadVersioned(local, remoteDir, base, ".html", tag);
      newName = up.name;
      log(`섹션 업로드 → ${newName}`);
      const pattern = new RegExp(c.plan.indexImportPattern || `<!--@import\\(/moa/import/main/${base}[_a-z0-9]*\\.html\\)-->`);
      await D.withSftp(async (s) => {
        const tmp = require("os").tmpdir() + `/idx_${Date.now()}.html`;
        await s.fastGet("/skin2/index.html", tmp);
        let h = fs.readFileSync(tmp, "utf8");
        const m = h.match(pattern);
        if (!m) throw new Error(`index 에서 교체 대상을 못 찾음: ${pattern}`);
        h = h.replace(m[0], `<!--@import(/moa/import/main/${newName})-->`);
        fs.writeFileSync(tmp, h); await s.fastPut(tmp, "/skin2/index.html"); fs.unlinkSync(tmp);
        log("index 교체");
      });
    }

    const v = await D.verifyLiveRetry({
      retries: 6, retryDelayMs: 40000,
      checks: { selectors: { ".pvh": 1, ".pvm": 1 }, noBrokenImagesIn: ".pvm" },
    });
    if (!v.ok) { await D.restore(bk.saved); throw new Error("검증 실패 → 롤백: " + v.fails.join(" / ")); }
    return `배포 완료${newName ? ` (${newName})` : ""}`;
  });
}

async function tick() {
  const list = await approvedChanges();
  if (!list.length) return 0;
  for (const c of list) {
    console.log(`▶ ${c.id} ${c.title}`);
    try {
      const summary = await deploy(c);
      c.status = "deployed"; c.result = summary;
      await tg(`✅ <b>웹사이트 반영 완료</b>\n${c.title}\n${summary}\n\nhttps://paulvice.co.kr`);
    } catch (e) {
      c.status = "failed"; c.result = e.message;
      await tg(`⚠️ <b>웹사이트 반영 실패</b>\n${c.title}\n${e.message}\n\n원상복구했습니다.`);
    }
    c.deployedAt = new Date().toISOString();
    await saveChange(c);
    console.log(`◀ ${c.status}: ${c.result}`);
  }
  return list.length;
}

(async () => {
  if (process.argv.includes("--watch")) {
    console.log("워커 상주 시작 (60초 간격)");
    for (;;) { try { await tick(); } catch (e) { console.error("tick ERR", e.message); } await new Promise((r) => setTimeout(r, 60000)); }
  } else {
    const n = await tick();
    console.log(n ? `${n}건 처리` : "승인 대기 건 없음");
  }
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
