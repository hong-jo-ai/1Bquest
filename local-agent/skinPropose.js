/**
 * 웹사이트 변경 제안 → 텔레그램 승인 카드 (2026-08-24)
 *
 * 흐름: 에이전트가 시안을 만들고 이 스크립트로 제안을 올린다 → 사장님이 카드에서 [적용] →
 *       webhook 이 kv 를 approved 로 바꿈 → skinDeployWorker.js 가 실제 배포.
 * 사장님이 직접 하실 일은 **버튼 한 번**뿐이다.
 *
 * 사용: node skinPropose.js '<json spec>'        (spec 예시는 파일 하단)
 *       node skinPropose.js --file spec.json
 *       --dry 를 붙이면 카드 미리보기만 출력하고 저장·발송 안 함
 */
require("dotenv").config({ override: true });
const path = require("path"), fs = require("fs");
const { createClient } = require(path.resolve(__dirname, "..", "node_modules/@supabase/supabase-js"));
function loadEnv(p){ try{ for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");} }catch{} }
loadEnv(path.resolve(__dirname, "..", ".env.supabase"));
loadEnv(path.resolve(__dirname, ".env"));

const sb = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const KEY = (id) => `skin:change:${id}`, INDEX_KEY = "skin:change:index";

async function save(c) {
  const s = sb();
  await s.from("kv_store").upsert({ key: KEY(c.id), data: c, updated_at: new Date().toISOString() }, { onConflict: "key" });
  const { data } = await s.from("kv_store").select("data").eq("key", INDEX_KEY).maybeSingle();
  const ids = Array.isArray(data?.data) ? data.data : [];
  if (!ids.includes(c.id)) { ids.unshift(c.id); await s.from("kv_store").upsert({ key: INDEX_KEY, data: ids.slice(0, 100), updated_at: new Date().toISOString() }, { onConflict: "key" }); }
}

async function sendCard(c) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("텔레그램 환경변수 없음");
  const text = `🖥 <b>웹사이트 변경 제안</b>\n\n<b>${c.title}</b>\n${c.summary}` +
    (c.previewUrl ? `\n\n미리보기: ${c.previewUrl}` : "") +
    `\n\n적용하면 백업·검증까지 자동으로 돌고, 문제가 있으면 원상복구합니다.`;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat, text, parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[
        { text: "✅ 적용", callback_data: `skin:accept:${c.id}` },
        { text: "❌ 안 함", callback_data: `skin:reject:${c.id}` },
      ]] },
    }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error("텔레그램 발송 실패: " + JSON.stringify(j).slice(0, 200));
}

(async () => {
  const dry = process.argv.includes("--dry");
  const fi = process.argv.indexOf("--file");
  const raw = fi >= 0 ? fs.readFileSync(process.argv[fi + 1], "utf8")
    : process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!raw) throw new Error("변경안 JSON 이 필요합니다");
  const spec = JSON.parse(raw);
  const c = {
    id: spec.id || `chg_${Date.now().toString(36)}`,
    kind: spec.kind || "sections",
    title: spec.title, summary: spec.summary, plan: spec.plan || {},
    previewUrl: spec.previewUrl, status: "pending", createdAt: new Date().toISOString(),
  };
  if (!c.title || !c.summary) throw new Error("title·summary 필수");
  console.log(JSON.stringify(c, null, 1));
  if (dry) return console.log("\nDRY — 저장·발송 안 함");
  await save(c);
  await sendCard(c);
  console.log("\n✅ 승인 카드 발송:", c.id);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

/* spec 예시:
{
  "kind": "sections",
  "title": "가을 히어로 교체",
  "summary": "여름 컷 → 제품 매크로 + AUTUMN 2026 라벨",
  "plan": {
    "images": [{"local":"/path/hero_m.jpg","remote":"/web/product/paulvice-main/hero/hero_m_2609.jpg"}],
    "section": {"local":"/path/pv_hero.html","remoteDir":"/skin2/moa/import/main","base":"pv_hero"}
  }
}
*/
