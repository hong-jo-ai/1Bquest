/**
 * 리뷰요청 성과 지표 — "보냈다"가 아니라 "몇 개가 리뷰가 됐나"를 계산한다.
 *
 * 퍼널: 요청 → 도달 → 열람 → 작성
 *   요청: review_request_log (우리가 보내기로 한 건)
 *   도달: Solapi 원장 (알림톡이 실제 수신됐는지 — 우리 DB엔 없다)
 *   열람: review_links.first_clicked_at (짧은 링크를 눌렀는지)
 *   작성: reviews
 *
 * 이 네 칸이 다 있어야 "어디서 새는지"를 말할 수 있다.
 * 도달이 낮으면 번호·채널 문제, 열람이 낮으면 문안·타이밍 문제,
 * 작성이 낮으면 폼·보상 문제다. 하나라도 비면 원인을 추측하게 된다.
 *
 * ⚠️ 기간을 맞출 때 주의: 요청은 오늘 나가고 리뷰는 며칠 뒤 들어온다.
 *    같은 기간의 요청 수와 리뷰 수를 나눈 값은 **근사치**다. 정확히 보려면
 *    요청 건별로 추적해야 하는데, 그건 review_links 클릭이 쌓인 뒤에 가능하다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

const rate = (a: number, b: number) => (b > 0 ? a / b : 0);

export interface DeliveryStat {
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
  /** 실패 사유별 건수 — 우리가 고칠 수 있는 것과 아닌 것이 섞여 있다 */
  reasons: Array<{ reason: string; count: number; fixable: boolean }>;
  /** 알림톡 / SMS 비율 */
  byType: Record<string, number>;
  cachedAt: string;
}

export interface ReviewMetrics {
  days: number;
  requested: number;
  requestFailed: number;
  /** 재시도 한도까지 가서 포기한 건 */
  givenUp: number;
  delivery: DeliveryStat | null;
  clicked: number;
  clickRate: number;
  written: number;
  /** 도달 대비 작성 — 이게 사장님이 보는 전환율 */
  conversionRate: number;
  /** 열람 대비 작성 — 폼이 제 몫을 하는지 */
  clickToWriteRate: number;
  avgRating: number;
  ratingDist: Record<string, number>;
  byMall: Record<string, { requested: number; written: number }>;
  withPhoto: number;
  recent: Array<{ mall: string; product: string | null; rating: number | null; at: string; name: string | null }>;
  /** 대기 중 — 아직 리뷰가 안 온 요청(최근 것은 정상, 오래된 건 사실상 실패) */
  pending: number;
}

// ── Solapi 도달률 ───────────────────────────────────────────────────────────

/**
 * 리뷰요청 알림톡의 실제 도달을 Solapi 원장에서 센다.
 *
 * 왜 우리 DB 로 안 되는가: 우리는 "접수 성공"까지만 안다. 카카오톡 미사용·수신차단은
 * 접수 뒤에 실패로 바뀌어서, 우리 로그엔 성공으로 남아 있다.
 * 실제로 이 차이 때문에 최근 30일 136건 중 21건이 안 갔는데도 보낸 것으로 집계되고 있었다.
 *
 * 대시보드가 열릴 때마다 부르면 느리니 KV 에 30분 캐시한다.
 */
// 기간별로 캐시를 나눈다. 하나로 묶으면 30일치를 60일 조회에 그대로 돌려줘 숫자가 틀린다.
const CACHE_KEY = (days: number) => `reviews:delivery:v1:${days}d`;
const CACHE_TTL_MS = 30 * 60 * 1000;

function solapiAuth(): Record<string, string> | null {
  const apiKey = process.env.SOLAPI_API_KEY, secret = process.env.SOLAPI_API_SECRET;
  if (!apiKey || !secret) return null;
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const sig = crypto.createHmac("sha256", secret).update(date + salt).digest("hex");
  return { Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${sig}` };
}

/** 승인된 리뷰요청 알림톡 템플릿 — 이 템플릿으로 나간 것만 리뷰요청이다. */
function reviewTemplates(): Set<string> {
  return new Set([
    process.env.REVIEW_KAKAO_TEMPLATE_PAULVICE,
    process.env.REVIEW_KAKAO_TEMPLATE_HARRIOT,
  ].filter(Boolean) as string[]);
}

/** 우리가 고칠 수 있는 실패인지. 고객이 카톡을 안 쓰는 건 우리 잘못이 아니다. */
function classifyFailure(statusCode: string, message: string): { reason: string; fixable: boolean } {
  if (/3027|3051|톡 유저가 아님|카카오톡을 사용하지 않/.test(message)) return { reason: "카카오톡 미사용", fixable: false };
  if (/3052|수신 차단/.test(message)) return { reason: "알림톡 수신차단", fixable: false };
  if (/3032|결번|서비스\s*정지/.test(message)) return { reason: "결번·정지 번호", fixable: true };
  if (statusCode === "1026") return { reason: "접수 실패(재시도 대상)", fixable: true };
  return { reason: `기타 오류 ${statusCode}`, fixable: true };
}

export async function deliveryStat(days = 30, force = false): Promise<DeliveryStat | null> {
  const sb = db();
  if (sb && !force) {
    const { data } = await sb.from("kv_store").select("data,updated_at").eq("key", CACHE_KEY(days)).maybeSingle();
    const cached = data?.data as DeliveryStat | undefined;
    if (cached && Date.now() - new Date(data!.updated_at as string).getTime() < CACHE_TTL_MS) return cached;
  }
  const H = solapiAuth();
  const templates = reviewTemplates();
  if (!H || !templates.size) return null;

  const all: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  for (let i = 0; i < 6; i++) {
    const q = new URLSearchParams({ limit: "500", startDate: new Date(Date.now() - days * 86400000).toISOString() });
    if (cursor) q.set("startKey", cursor);
    const r = await fetch(`https://api.solapi.com/messages/v4/list?${q}`, { headers: H });
    if (!r.ok) break;
    const j = (await r.json()) as { messageList?: Record<string, Record<string, unknown>>; nextKey?: string };
    const list = Object.values(j.messageList ?? {});
    all.push(...list);
    if (!j.nextKey || !list.length) break;
    cursor = j.nextKey;
  }

  // ⚠️ Solapi 의 startDate 파라미터는 실제로 걸러주지 않는다(요청해도 전체 기간이 온다).
  //    믿고 그대로 쓰면 기간이 뻥튀기된다 — 실제로 "30일 310건"이 알고 보니 60일치였다.
  //    받아온 뒤 dateCreated 로 직접 자른다.
  const cutoff = Date.now() - days * 86400000;
  const rv = all.filter((x) =>
    templates.has((x.kakaoOptions as { templateId?: string } | undefined)?.templateId ?? "")
    && new Date(String(x.dateCreated ?? 0)).getTime() >= cutoff);
  const reasons = new Map<string, { count: number; fixable: boolean }>();
  const byType: Record<string, number> = {};
  let delivered = 0;
  for (const x of rv) {
    byType[String(x.type)] = (byType[String(x.type)] ?? 0) + 1;
    if (x.statusCode === "4000") { delivered++; continue; }
    const last = (x.log as Array<{ message: string }> | undefined)?.slice(-1)[0]?.message ?? "";
    const { reason, fixable } = classifyFailure(String(x.statusCode), last);
    const c = reasons.get(reason) ?? { count: 0, fixable };
    c.count++;
    reasons.set(reason, c);
  }

  const stat: DeliveryStat = {
    sent: rv.length,
    delivered,
    failed: rv.length - delivered,
    deliveryRate: rate(delivered, rv.length),
    reasons: [...reasons.entries()].map(([reason, v]) => ({ reason, count: v.count, fixable: v.fixable }))
      .sort((a, b) => b.count - a.count),
    byType,
    cachedAt: new Date().toISOString(),
  };
  if (sb) {
    await sb.from("kv_store").upsert(
      { key: CACHE_KEY(days), data: stat, updated_at: new Date().toISOString() }, { onConflict: "key" },
    ).then(() => {}, () => {});
  }
  return stat;
}

// ── 전체 ────────────────────────────────────────────────────────────────────

export async function reviewMetrics(days = 30): Promise<ReviewMetrics | null> {
  const sb = db(); if (!sb) return null;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [reqRes, revRes, linkRes, delivery] = await Promise.all([
    sb.from("review_request_log").select("mall,status,attempts,sent_at").gte("sent_at", since),
    sb.from("reviews").select("mall,product_name,rating,created_at,customer_name,media").gte("created_at", since),
    sb.from("review_links").select("mall,first_clicked_at,created_at").gte("created_at", since),
    deliveryStat(days).catch(() => null),
  ]);

  type Req = { mall: string; status: string | null; attempts: number | null; sent_at: string };
  type Rev = { mall: string; product_name: string | null; rating: number | null; created_at: string; customer_name: string | null; media: unknown };
  type Link = { mall: string | null; first_clicked_at: string | null };
  const reqs = (reqRes.data ?? []) as Req[];
  const revs = (revRes.data ?? []) as Rev[];
  const links = (linkRes.data ?? []) as Link[];

  const requested = reqs.length;
  const requestFailed = reqs.filter((r) => r.status === "failed").length;
  const givenUp = reqs.filter((r) => r.status === "failed" && (r.attempts ?? 0) >= 3).length;
  const clicked = links.filter((l) => l.first_clicked_at).length;
  const written = revs.length;

  const ratingDist: Record<string, number> = {};
  let ratingSum = 0, ratingN = 0;
  for (const r of revs) {
    const k = String(r.rating ?? "-");
    ratingDist[k] = (ratingDist[k] ?? 0) + 1;
    if (typeof r.rating === "number") { ratingSum += r.rating; ratingN++; }
  }

  const byMall: ReviewMetrics["byMall"] = {};
  for (const r of reqs) {
    const c = byMall[r.mall] ?? { requested: 0, written: 0 };
    c.requested++; byMall[r.mall] = c;
  }
  for (const r of revs) {
    const c = byMall[r.mall] ?? { requested: 0, written: 0 };
    c.written++; byMall[r.mall] = c;
  }

  // 도달을 알면 도달 기준으로, 모르면 요청 기준으로 전환율을 낸다.
  // 분모가 다르면 숫자의 뜻이 달라지므로 UI 에 어느 쪽인지 같이 적는다.
  const reachBase = delivery?.delivered || requested;

  return {
    days,
    requested, requestFailed, givenUp,
    delivery,
    clicked, clickRate: rate(clicked, reachBase),
    written,
    conversionRate: rate(written, reachBase),
    clickToWriteRate: rate(written, clicked),
    avgRating: ratingN ? ratingSum / ratingN : 0,
    ratingDist,
    byMall,
    withPhoto: revs.filter((r) => Array.isArray(r.media) ? r.media.length > 0 : !!r.media).length,
    recent: revs
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 8)
      .map((r) => ({ mall: r.mall, product: r.product_name, rating: r.rating, at: r.created_at, name: r.customer_name })),
    pending: Math.max(0, reachBase - written),
  };
}
