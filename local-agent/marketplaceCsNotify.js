/**
 * 마켓(W컨셉·무신사·29CM) CS 텔레그램 알림.
 *
 * 사장님 방침(2026-09-01): **마켓 CS 는 인박스로 가져오지 않는다.**
 * 이 채널들은 답장도 각 마켓 어드민에서만 되고(우리 발송 경로 없음),
 * 인박스에 쌓아두면 "인박스에서 처리 가능한 것"과 섞여 오히려 놓친다.
 * → 새 건이 생기면 **알림만 보내고 사장님이 직접 들어가서 본다.**
 *
 * 재알림 방지: 마켓·클레임 키를 kv `marketplace_cs_seen:<market>` 에 누적한다.
 * 상태가 바뀌면(접수 → 반품완료) 키가 달라지므로 다시 알린다 — 그게 맞다.
 */
const fs = require("fs");
const path = require("path");

function loadEnv() {
  for (const f of [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env.local"), path.join(__dirname, "..", ".env.supabase")]) {
    try {
      for (const l of fs.readFileSync(f, "utf8").split("\n")) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) { const v = m[2].trim().replace(/^["']|["']$/g, ""); if (!(m[1] in process.env)) process.env[m[1]] = v; }
      }
    } catch { /* 없는 파일 무시 */ }
  }
}

const MARKETS = {
  wconcept: { label: "W컨셉", url: "https://newpin.wconcept.co.kr/Order/OrderReturnManageShipping?type=return" },
  musinsa:  { label: "무신사", url: "https://partner.musinsa.com/claim/list" },
  cm29:     { label: "29CM",  url: "https://partner-order.29cm.co.kr/claim" },
};

function kvUrl() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL 없음");
  return url;
}
function kvHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function loadSeen(market) {
  try {
    const r = await fetch(`${kvUrl()}/rest/v1/kv_store?key=eq.marketplace_cs_seen:${market}&select=data`, {
      headers: kvHeaders(), signal: AbortSignal.timeout(10000),
    });
    const rows = await r.json();
    const keys = rows?.[0]?.data?.keys;
    return new Set(Array.isArray(keys) ? keys : []);
  } catch {
    // 조회 실패 시 빈 집합을 주면 전건 재알림이 된다 → null 로 알리고 호출측이 중단하게 한다.
    return null;
  }
}

async function saveSeen(market, seen) {
  const now = new Date().toISOString();
  // 무한 증식 방지 — 최근 500개만 남긴다(마켓 클레임은 몇 달이면 종결).
  const keys = [...seen].slice(-500);
  await fetch(`${kvUrl()}/rest/v1/kv_store?on_conflict=key`, {
    method: "POST",
    headers: { ...kvHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ key: `marketplace_cs_seen:${market}`, data: { keys, at: now }, updated_at: now }),
    signal: AbortSignal.timeout(10000),
  });
}

/** 클레임 1건 → 재알림 판별 키. 상태가 바뀌면 키도 바뀐다. */
function claimKey(c) {
  return [c.orderNumber, c.claimType || "", c.statusText || ""].join("|");
}

function formatClaim(c) {
  const bits = [`<b>${c.orderNumber}</b>`];
  if (c.customerName) bits.push(c.customerName);
  if (c.statusText) bits.push(c.statusText);
  const head = bits.join(" · ");
  const lines = [head];
  if (c.product) lines.push(`  ${String(c.product).slice(0, 60)}`);
  if (c.reason) lines.push(`  사유: ${String(c.reason).slice(0, 50)}`);
  return lines.join("\n");
}

/**
 * 새 클레임만 골라 텔레그램으로 알린다. 인박스 적재는 하지 않는다.
 * @param {"wconcept"|"musinsa"|"cm29"} market
 * @param {Array<{orderNumber:string,claimType?:string,statusText?:string,customerName?:string,product?:string,reason?:string}>} claims
 * @returns {Promise<{notified:number, skipped:number}>}
 */
async function notifyMarketplaceCs(market, claims) {
  loadEnv();
  const m = MARKETS[market];
  if (!m) throw new Error(`알 수 없는 마켓: ${market}`);
  if (!claims || !claims.length) return { notified: 0, skipped: 0 };

  const seen = await loadSeen(market);
  if (seen === null) {
    // 본 적 있는 건을 모르는 채로 알리면 전건이 다시 나간다. 차라리 이번 회차를 거른다.
    console.log(`[marketplaceCs] ${market}: seen 조회 실패 — 이번 회차 알림 생략`);
    return { notified: 0, skipped: claims.length };
  }

  // 종결된 건(반품완료·취소·반려)은 알릴 이유가 없다. 알림은 **손이 필요한 것**만.
  // 이 필터가 없으면 상태 문구가 바뀔 때마다 종결건이 다시 튀어나온다.
  const actionable = claims.filter((c) => c.status !== "done" && c.status !== "rejected");
  const fresh = actionable.filter((c) => c.orderNumber && !seen.has(claimKey(c)));
  if (!fresh.length) return { notified: 0, skipped: claims.length };

  const body = fresh.map(formatClaim).join("\n\n");
  const text =
    `📮 <b>${m.label} CS ${fresh.length}건</b>\n` +
    `인박스로 안 가져옵니다 — 아래에서 직접 처리해 주세요.\n\n` +
    `${body}\n\n${m.url}`;

  const { sendTelegram } = require("./notifyFail");
  await sendTelegram(text, { tag: `marketplace-cs-${market}` });

  fresh.forEach((c) => seen.add(claimKey(c)));
  await saveSeen(market, seen).catch((e) => console.log(`[marketplaceCs] seen 저장 실패: ${e.message}`));
  return { notified: fresh.length, skipped: claims.length - fresh.length };
}

module.exports = { notifyMarketplaceCs, MARKETS };
