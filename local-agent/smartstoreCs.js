/**
 * 스마트스토어(네이버) 커머스 API — CS 전용 헬퍼.
 *
 * ⚠️ 커머스 API 는 **IP 화이트리스트**다. 등록된 IP(이 아이맥)에서만 호출이 통하고,
 * Vercel 에서 부르면 `GW.IP_NOT_ALLOWED` 403 이 난다. 그래서 네이버를 만지는 코드는
 * 전부 여기(local-agent)에 있고, 대시보드는 결과만 받는다.
 *
 * 인증: client_secret 을 **bcrypt salt 로 써서** `{clientId}_{timestamp}` 를 해싱한 값이 서명.
 */
const fs = require("fs"), path = require("path");
const DASH = "/Users/mac/sungjo_ai/paulwise-dashboard";
function loadEnv(p) {
  try {
    for (const l of fs.readFileSync(p, "utf8").split("\n")) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
}
loadEnv(path.join(DASH, ".env.local"));
loadEnv(path.join(DASH, ".env.supabase"));
loadEnv(path.join(__dirname, ".env"));

const bcrypt = require(path.join(DASH, "node_modules/bcryptjs"));
const API = "https://api.commerce.naver.com/external";

let cached = null;

async function token() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const ID = process.env.NAVER_COMMERCE_CLIENT_ID, SEC = process.env.NAVER_COMMERCE_CLIENT_SECRET;
  if (!ID || !SEC) throw new Error("NAVER_COMMERCE_CLIENT_ID / SECRET 환경변수 누락");
  const ts = Date.now();
  const sign = Buffer.from(bcrypt.hashSync(`${ID}_${ts}`, SEC)).toString("base64");
  const r = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ID, timestamp: String(ts), client_secret_sign: sign,
      grant_type: "client_credentials", type: "SELF",
    }),
  });
  if (!r.ok) throw new Error(`커머스 토큰 실패 ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 10800) * 1000 - 60000 };
  return j.access_token;
}

async function api(method, p, body) {
  const t = await token();
  const r = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: "Bearer " + t,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`커머스 ${method} ${p} → ${r.status} ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

/** 고객 문의(1:1) 목록. ⚠️ size 가 10 미만이면 400 이 난다(실측). */
async function listInquiries({ days = 14, page = 1, size = 50 } = {}) {
  const now = new Date(), from = new Date(now.getTime() - days * 864e5);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const q = new URLSearchParams({
    startSearchDate: ymd(from), endSearchDate: ymd(now),
    page: String(page), size: String(Math.max(10, size)),
  });
  return api("GET", `/v1/pay-user/inquiries?${q}`);
}

/** ⚠️ 조회는 `/v1/pay-user/`, 답변은 `/v1/pay-merchant/` — 접두어가 다르다. */
async function answerInquiry(inquiryNo, content) {
  return api("POST", `/v1/pay-merchant/inquiries/${inquiryNo}/answer`, { answerContent: content });
}

/** 문의 전체(페이지 순회)를 모아 반환. */
async function collectInquiries(days = 14) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await listInquiries({ days, page });
    const items = res?.content ?? [];
    out.push(...items);
    if (items.length === 0 || res?.last) break;
  }
  return out;
}

module.exports = { token, api, listInquiries, answerInquiry, collectInquiries, API };
