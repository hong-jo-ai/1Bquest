/**
 * 씨티와치 위탁 구모델(성산·서해·가양·광안·일구·도보·카리) 판매 수량 집계.
 * 2026-09-23 합의: 총액 29,443,289 에 8/13 이후 판매 75개까지 포함, 초과분은 개당 20,000원을 잔액에 더한다(월 100만 고정, 기간만 늘어남).
 * 사용: node local-agent/citywatchSoldCount.js [start=2026-08-13] [end=오늘]
 *
 * 소스 ①카페24 API 양샵(shop_no 1·2, 취소 제외) ②pp_shipments 조선몰·b2b_harriot·직거래(교환/회수/-EX 제외).
 * ⚠️ 카페24 토큰은 kv 캐시만 쓴다(로컬 refresh 금지, ops.md). 만료면 대시보드에서 한 번 호출해 갱신되게 할 것.
 * ⚠️ 조선몰은 출고 기준이라 반품이 빠지지 않는다 — 정산 전 조선몰 반품분은 손으로 뺄 것.
 */
const path = require("path"), fs = require("fs");
const DASH = path.resolve(__dirname, "..");
function le(p){try{for(const l of fs.readFileSync(p,"utf8").split("\n")){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim().replace(/^["']|["']$/g,"");if(!(m[1] in process.env))process.env[m[1]]=v;}}catch{}}
le(path.join(DASH,".env.supabase")); le(path.join(DASH,".env.local")); le(path.join(DASH,"local-agent/.env"));
const { createClient } = require("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MALL = process.env.HARRIOT_CAFE24_MALL_ID;
const START = process.argv[2] || "2026-08-13";
const END = process.argv[3] || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const RE = /성산|서해|가양|광안|일구|도보|카리|Seongsan|Seohae|Gayang|Gwangan|Ilgu|Dobo|Kari/i;
const NOT = /설월|SEOLWOL|기원|KI:?WON|밴드|스트랩|Strap|Band/i;
const ALLOW = 75, UNIT = 20000;

(async () => {
  const { data } = await db.from("kv_store").select("data").eq("key", "cafe24_refresh_token:harriot").maybeSingle();
  const tok = data?.data?.access_token, exp = Number(data?.data?.expires_at || 0);
  if (!tok || exp <= Date.now()) { console.error("❌ 카페24 캐시 토큰 없음/만료 — 로컬 refresh 금지"); process.exit(2); }
  const get = async (u) => { const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } }); if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`); return r.json(); };

  const byModel = {}; let cafe = 0;
  for (const shop of [1, 2]) {
    let off = 0;
    while (true) {
      const qs = new URLSearchParams({ start_date: START, end_date: END, limit: "100", offset: String(off), embed: "items", shop_no: String(shop) });
      const j = await get(`https://${MALL}.cafe24api.com/api/v2/admin/orders?${qs}`);
      const b = j.orders || [];
      for (const o of b) for (const it of (o.items || [])) {
        const n = it.product_name || "";
        if (it.canceled === "T" || /^C4/.test(it.order_status || "") || !RE.test(n) || NOT.test(n)) continue;
        const q = Number(it.quantity || 0); cafe += q; byModel[n] = (byModel[n] || 0) + q;
      }
      if (b.length < 100) break; off += 100;
    }
  }

  const { data: rows } = await db.from("pp_shipments").select("order_number,channel,product_name,qty,req_type,created_at")
    .gte("created_at", START).lte("created_at", END + "T23:59:59+09:00").in("channel", ["조선몰", "b2b_harriot", "직거래"]).order("created_at").range(0, 4999);
  const ch = {}; const skipped = [];
  for (const r of rows || []) {
    const n = r.product_name || "";
    if (!RE.test(n) || NOT.test(n)) continue;
    if (r.req_type === 2 || /-EX\b|-RT\b|-AS\b|오기입|회수|교환 재발송/.test(r.order_number + " " + n)) { skipped.push(`${r.order_number} ${n.slice(0, 40)}`); continue; }
    let units = Number(r.qty || 1);
    const parts = n.split(/\s\+\s/); if (parts.length > 1) units = parts.filter(p => RE.test(p)).length;
    const pts = n.match(/(\d+)점/g); if (pts) units = pts.map(x => parseInt(x)).reduce((a, b) => a + b, 0);
    ch[r.channel] = (ch[r.channel] || 0) + units;
  }
  const other = Object.values(ch).reduce((a, b) => a + b, 0), total = cafe + other;
  console.log(`씨티와치 위탁 구모델 판매 ${START} ~ ${END}`);
  console.log(`  카페24(양샵, 취소제외) ${cafe} | ` + Object.entries(ch).map(([k, v]) => `${k} ${v}`).join(" | ") + ` | 합계 ${total}`);
  console.log(`  카페24 모델별:`, Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
  if (skipped.length) console.log(`  제외(교환/회수): ${skipped.length}건 — ${skipped.join(" / ")}`);
  const over = Math.max(0, total - ALLOW);
  console.log(`  총액 포함분 ${ALLOW}개 → 초과 ${over}개 × ${UNIT.toLocaleString()} = ${(over * UNIT).toLocaleString()}원 → 잔액에 가산(월 100만 고정, 기간만 늘어남)`);
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
