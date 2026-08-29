/**
 * CRM 성과 지표 — "몇 명 모였나"가 아니라 "얼마 벌었나"를 계산한다.
 *
 * 메타 광고관리자와 같은 언어로 읽히게 맞췄다:
 *   노출(발송) → 클릭(CTR·CPC) → 전환(CVR·CPA) → 매출(ROAS·AOV)
 * 광고와 다른 점은 두 가지다.
 *
 *  ① **비용이 거의 0에 가깝다.** 문자 20~50원, CARE 카드 122원.
 *     그래서 ROAS 가 광고처럼 3~5가 아니라 수십~수백으로 찍힌다. 정상이다.
 *     CRM 의 진짜 비용은 명단(모수)을 모으는 데 이미 지불됐다.
 *
 *  ② **가만 둬도 살 사람이 섞여 있다.** 광고는 안 보여주면 안 오지만,
 *     문자는 안 보내도 재구매하는 사람이 있다. 그래서 매출 총액을 성과라고
 *     부르면 과대평가된다 → 홀드아웃(일부러 안 보낸 대조군)의 구매율과 비교해
 *     **증분(lift)** 을 따로 낸다. 홀드아웃이 없으면 증분은 null 로 두고
 *     "측정 불가"라고 말한다. 추정치를 성과처럼 쓰지 않는다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { listCampaigns, type Campaign, type CampaignTarget } from "./campaign";

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/**
 * 건당 단가(원). SMS/LMS 는 lib/sms/solapi.ts 의 추정치와 같은 값이고,
 * CARE 카드는 실측이다(2026-08-28, 1,000장 122,100원 결제).
 */
export const UNIT_COST = {
  sms: 20,
  lms: 50,
  email: 0,      // 자체 발송이라 한계비용 0으로 본다
  careCard: 122, // 아트지+소프트터치 라미, 1,000장 기준 실측
} as const;

// ── 캠페인 ──────────────────────────────────────────────────────────────────

export interface CampaignMetrics {
  id: string; name: string; brand: string | null;
  sentAt: string | null; status: Campaign["status"];
  /** 명단 규모(홀드아웃 포함) */
  targets: number;
  sent: number; delivered: number;
  clicked: number; carted: number; purchased: number;
  revenue: number;
  cost: number;
  /** 도달 대비 클릭 */
  ctr: number;
  /** 도달 대비 구매 */
  cvr: number;
  /** 클릭 대비 구매 — 랜딩이 제 몫을 했는지 */
  clickCvr: number;
  /** 클릭 1회당 비용 */
  cpc: number | null;
  /** 구매 1건당 비용 */
  cpa: number | null;
  /** 매출 ÷ 비용 */
  roas: number | null;
  /** 객단가 */
  aov: number;
  /** 발송 1건이 만든 매출 — 다음 캠페인 규모를 정할 때 이 숫자를 쓴다 */
  revenuePerSend: number;
  holdout: HoldoutResult | null;
}

export interface HoldoutResult {
  size: number;
  purchased: number;
  /** 홀드아웃 구매율 = 문자가 없었어도 샀을 비율 */
  baseCvr: number;
  /** 발송군 구매율 − 홀드아웃 구매율 */
  liftPp: number;
  /** 증분 구매건수 = 발송 × lift */
  incrementalPurchases: number;
  /** 증분 매출 = 증분 구매건수 × 객단가 */
  incrementalRevenue: number;
  incrementalRoas: number | null;
}

const rate = (a: number, b: number) => (b > 0 ? a / b : 0);
const div = (a: number, b: number) => (b > 0 ? a / b : null);

/** 캠페인 메시지 길이로 SMS/LMS 를 판정해 발송 비용을 낸다. 이메일 대상은 0원. */
function costOf(rows: CampaignTarget[], message: string | null | undefined): number {
  const bytes = Buffer.byteLength(String(message ?? ""), "euc-kr" as BufferEncoding) || String(message ?? "").length * 2;
  const smsUnit = bytes <= 90 ? UNIT_COST.sms : UNIT_COST.lms;
  let total = 0;
  for (const r of rows) {
    if (!r.sent_at) continue;                       // 안 보낸 건 과금 안 된다(홀드아웃 포함)
    total += r.channel === "email" ? UNIT_COST.email : smsUnit;
  }
  return total;
}

export async function campaignMetrics(c: Campaign): Promise<CampaignMetrics> {
  const sb = db();
  const rows: CampaignTarget[] = [];
  if (sb) {
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from("crm_campaign_targets").select("*").eq("campaign_id", c.id).range(from, from + 999);
      if (!data?.length) break;
      rows.push(...(data as CampaignTarget[]));
      if (data.length < 1000) break;
    }
  }

  const held = rows.filter((r) => (r as CampaignTarget & { holdout?: boolean }).holdout);
  const treated = rows.filter((r) => !(r as CampaignTarget & { holdout?: boolean }).holdout);

  const sent      = treated.filter((r) => r.sent_at).length;
  const delivered = treated.filter((r) => r.send_status === "ok" || r.send_status === "delivered").length;
  const clicked   = treated.filter((r) => r.clicked_at).length;
  const carted    = treated.filter((r) => r.cart_at).length;
  const purchased = treated.filter((r) => r.purchased_at).length;
  const revenue   = treated.reduce((a, r) => a + Number(r.revenue || 0), 0);
  const cost      = costOf(rows, c.message);
  // 도달을 모르는 경우(발송 결과 미기록)는 발송 수를 분모로 쓴다 — 0으로 나눠 빈 칸이 되는 것보다 낫다.
  const reach = delivered || sent;
  const aov = rate(revenue, purchased);

  let holdout: HoldoutResult | null = null;
  if (held.length >= 20) {                          // 표본이 너무 작으면 비율이 요동쳐 오히려 오해를 부른다
    const hPurchased = held.filter((r) => r.purchased_at).length;
    const baseCvr = rate(hPurchased, held.length);
    const liftPp = rate(purchased, reach) - baseCvr;
    const incrementalPurchases = liftPp * reach;
    const incrementalRevenue = incrementalPurchases * aov;
    holdout = {
      size: held.length, purchased: hPurchased, baseCvr, liftPp,
      incrementalPurchases, incrementalRevenue,
      incrementalRoas: div(incrementalRevenue, cost),
    };
  }

  return {
    id: c.id, name: c.name, brand: (c as Campaign & { brand?: string }).brand ?? null,
    sentAt: c.sentAt ?? null, status: c.status,
    targets: rows.length, sent, delivered, clicked, carted, purchased, revenue, cost,
    ctr: rate(clicked, reach),
    cvr: rate(purchased, reach),
    clickCvr: rate(purchased, clicked),
    cpc: div(cost, clicked),
    cpa: div(cost, purchased),
    roas: div(revenue, cost),
    aov,
    revenuePerSend: rate(revenue, reach),
    holdout,
  };
}

// ── CARE ────────────────────────────────────────────────────────────────────

export interface CareMetrics {
  /** 카드가 들어간 소포 수 = 카드 배포량 */
  cardsShipped: number;
  cardCost: number;
  registered: number;
  /** 배포 대비 등록 = 카드의 실제 효율 */
  registerRate: number;
  /** 등록 1건을 얻는 데 든 카드 비용 */
  costPerRegistration: number | null;
  consent: number;
  consentRate: number;
  /** 등록 후 자사몰에서 산 사람 */
  buyers: number;
  /** 등록자 중 구매 전환율 — CARE 의 존재 이유 */
  buyerRate: number;
  revenue: number;
  aov: number;
  /** 등록자 1인이 만든 매출 */
  revenuePerRegistration: number;
  roas: number | null;
  couponUsed: number;
  couponUseRate: number;
  /** 첫 등록일 — 아직 짧으면 지표를 그대로 믿으면 안 된다 */
  since: string | null;
  daysRunning: number;
  byChannel: Record<string, { total: number; consent: number; buyers: number; revenue: number }>;
}

/**
 * 카드 배포량 = 시작일 이후 나간 **폴바이스 시계** 수.
 *
 * 사장님 방침: 카드가 도착한 날부터 나가는 모든 폴바이스 시계에 동봉(2026-08-30).
 * 자사몰 주문에도 들어간다 — 배송 준비 때 채널을 구분해 넣는 건 현실적으로 불가능하다.
 *
 * ⚠️ 전체 소포 수를 쓰면 안 된다. 증정 스트랩·조절도구·주얼리가 각각 별도 행이라
 *    분모가 2배 넘게 부풀고 등록률이 실제의 절반으로 보인다(최근 30일 510행 중 시계는 ~210).
 */
const HARRIOT_LINE = /(해리엇|기원|성산|가양|광안|도보|설월|썬레이)/;
const ACCESSORY    = /(팔찌|목걸이|귀걸이|반지|조절|도구|케이스|파우치|시계줄|스프링바|버클|공구)/;
// 라인명 또는 '워치'를 요구한다. 맨 '시계'만으로 받으면
// "여성시계 가죽밴드 블랙 12mm" 같은 밴드 단품이 시계로 새어 들어온다.
const PV_WATCH     = /(에끌라|오드리|미니엘|켈리|잭클린|옥타곤|워치)/;

export function isPaulviceWatch(name: string | null | undefined): boolean {
  const n = String(name ?? "");
  if (!n) return false;
  if (n.includes("[증정]")) return false;             // 사은품 행은 같은 주문의 중복
  if (HARRIOT_LINE.test(n)) return false;             // CARE 는 폴바이스 전용
  if (ACCESSORY.test(n)) return false;
  // "가죽밴드"·"스트랩 12mm" 같은 단품. 단 "…워치 + 메탈밴드" 세트는 시계라 남긴다.
  if (/(스트랩|밴드)/.test(n) && !/(워치|시계)/.test(n)) return false;
  return PV_WATCH.test(n);
}

async function cardsShippedSince(sb: SupabaseClient, since: string): Promise<number> {
  const names: Array<{ product_name: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("pp_shipments")
      .select("product_name")
      .eq("req_type", "1").eq("is_test", false).gte("created_at", since)
      .range(from, from + 999);
    if (!data?.length) break;
    names.push(...(data as typeof names));
    if (data.length < 1000) break;
  }
  return names.filter((r) => isPaulviceWatch(r.product_name)).length;
}

export interface CareRegRow {
  phone: string; product_name: string | null; ad_consent: boolean; source: string | null;
  coupon_code: string | null; coupon_used_at: string | null; battery_used_at: string | null;
  registered_at: string; orders: number | null; revenue: number | null; first_order_at: string | null;
}

export async function careMetrics(startDate?: string): Promise<CareMetrics | null> {
  const sb = db(); if (!sb) return null;
  const { data } = await sb.from("care_registrations")
    .select("phone,product_name,ad_consent,source,coupon_code,coupon_used_at,battery_used_at,registered_at,orders,revenue,first_order_at")
    .order("registered_at", { ascending: false });
  const rows = (data ?? []) as CareRegRow[];

  // 시작일 = **카드를 박스에 넣기 시작한 날**. 이게 등록률의 분모를 정한다.
  // 첫 등록일로 대신하면 카드가 나가기 전 기간이 빠져 등록률이 부풀려진다 →
  // KV 로 실제 투입 개시일을 박아둘 수 있게 한다(운영 중 한 번만 정하면 된다).
  const { data: cfg } = await sb.from("kv_store").select("data").eq("key", "care:config:v1").maybeSingle();
  const configured = (cfg?.data as { cardStartDate?: string } | null)?.cardStartDate;
  const since = startDate || configured || rows[rows.length - 1]?.registered_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const cardsShipped = await cardsShippedSince(sb, since);

  const registered = rows.length;
  const consent = rows.filter((r) => r.ad_consent).length;
  const buyers = rows.filter((r) => (r.orders ?? 0) > 0).length;
  const revenue = rows.reduce((a, r) => a + Number(r.revenue || 0), 0);
  const orders = rows.reduce((a, r) => a + Number(r.orders || 0), 0);
  const couponUsed = rows.filter((r) => r.coupon_used_at).length;
  const cardCost = cardsShipped * UNIT_COST.careCard;

  const byChannel: CareMetrics["byChannel"] = {};
  for (const r of rows) {
    const ch = (r.source ?? "").split("/").pop() || "미확인";
    const c = byChannel[ch] ?? { total: 0, consent: 0, buyers: 0, revenue: 0 };
    c.total++;
    if (r.ad_consent) c.consent++;
    if ((r.orders ?? 0) > 0) c.buyers++;
    c.revenue += Number(r.revenue || 0);
    byChannel[ch] = c;
  }

  return {
    cardsShipped, cardCost, registered,
    registerRate: rate(registered, cardsShipped),
    costPerRegistration: div(cardCost, registered),
    consent, consentRate: rate(consent, registered),
    buyers, buyerRate: rate(buyers, registered),
    revenue, aov: rate(revenue, orders),
    revenuePerRegistration: rate(revenue, registered),
    roas: div(revenue, cardCost),
    couponUsed, couponUseRate: rate(couponUsed, registered),
    since,
    daysRunning: Math.max(1, Math.round((Date.now() - new Date(since).getTime()) / 86400000)),
    byChannel,
  };
}

// ── 전체 합계 ───────────────────────────────────────────────────────────────

export interface CrmTotals {
  revenue: number; cost: number; roas: number | null;
  conversions: number; cpa: number | null;
  incrementalRevenue: number | null;
}

export async function crmTotals(): Promise<{ totals: CrmTotals; campaigns: CampaignMetrics[]; care: CareMetrics | null }> {
  const list = await listCampaigns();
  const campaigns = await Promise.all(list.map(campaignMetrics));
  const care = await careMetrics();

  const revenue = campaigns.reduce((a, c) => a + c.revenue, 0) + (care?.revenue ?? 0);
  const cost    = campaigns.reduce((a, c) => a + c.cost, 0)    + (care?.cardCost ?? 0);
  const conversions = campaigns.reduce((a, c) => a + c.purchased, 0) + (care?.buyers ?? 0);
  // 증분은 홀드아웃이 있는 캠페인에서만 나온다. 하나도 없으면 null(=측정 안 함).
  const withHoldout = campaigns.filter((c) => c.holdout);
  const incrementalRevenue = withHoldout.length
    ? withHoldout.reduce((a, c) => a + (c.holdout?.incrementalRevenue ?? 0), 0)
    : null;

  return {
    totals: { revenue, cost, roas: div(revenue, cost), conversions, cpa: div(cost, conversions), incrementalRevenue },
    campaigns: campaigns.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "")),
    care,
  };
}
