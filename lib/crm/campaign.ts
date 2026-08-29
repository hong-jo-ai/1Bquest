/**
 * 신상 출시 CRM 캠페인 — 문자 한 통이 매출로 이어졌는지 사람 단위로 추적한다.
 *
 * 왜 필요한가: 지금까지는 "문자 보냈다"까지만 알고 그 뒤가 깜깜했다.
 * 옥타곤(1,000개) 같은 큰 물량은 초기 회전이 현금흐름을 좌우해서, 어떤 메시지가
 * 실제로 팔리게 했는지 알아야 다음 출시에서 재현할 수 있다.
 *
 * 추적 단계 (한 사람 = 한 행, `crm_campaign_targets`)
 *   발송 → 클릭 → 장바구니 → 구매
 *   ├ 발송   : Solapi 결과 (send_status)
 *   ├ 클릭   : /c/<code> 를 거치면 clicked_at. 코드는 1인 1개라 누가 눌렀는지 확정된다
 *   ├ 장바구니: pv-cart.js 가 클릭 때 심은 쿠키(pv_c)를 같이 보내면 cart_at
 *   └ 구매   : ① 전용 쿠폰코드(가장 정확) ② 수취인 전화번호 매칭(폴백)
 *
 * ⚠️ 발송 대상은 **자사몰에서 직접 구매한 고객**만 담는다.
 *    마켓(무신사·W컨셉·29CM·공구·카카오) 경유 고객은 배송 목적으로 받은 정보라
 *    광고 발송이 불가하다. 대상 산출은 buildTargetsFromShipments() 가 이 규칙을 강제한다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface Campaign {
  id: string;
  name: string;
  productNo?: number | null;
  couponCode?: string | null;
  landingUrl: string;
  message?: string | null;
  status: "draft" | "sent" | "done";
  createdAt: string;
  sentAt?: string | null;
}

export interface CampaignTarget {
  id?: string;
  campaign_id: string;
  code: string;
  name?: string | null;
  phone?: string | null;
  mall?: string;
  sent_at?: string | null;
  send_status?: string | null;
  clicked_at?: string | null;
  click_count?: number;
  cart_at?: string | null;
  purchased_at?: string | null;
  order_id?: string | null;
  revenue?: number | null;
  attribution?: string | null;
}

const K_CAMPAIGNS = "crm_campaigns:v1";

/** 자사몰 직접 구매로 인정하는 채널 — 이 목록 밖은 광고 발송 대상이 아니다. */
export const OWN_CHANNELS = ["카페24", "해리엇", "식스샵", "스마트스토어", "naver", "해리엇와치스"];

/**
 * 브랜드별 자사몰 채널. 설월(34.9만 해리엇 헤리티지)을 폴바이스 8.5만 시계 구매자에게
 * 보내는 건 맞지 않아서, 대상 산출 때 브랜드를 좁힐 수 있어야 한다.
 * ⚠️ 브랜드를 안 주면 종전대로 전체(=두 브랜드 합산)다.
 */
export const OWN_CHANNELS_BY_BRAND: Record<"paulvice" | "harriot", string[]> = {
  paulvice: ["카페24", "스마트스토어", "naver"],
  harriot:  ["해리엇", "해리엇와치스", "식스샵"],
};

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 짧고 헷갈리지 않는 코드 (혼동 문자 0/O/1/I/l 제외) */
function makeCode(len = 6): string {
  const A = "23456789abcdefghjkmnpqrstuvwxyz";
  let s = "";
  for (let i = 0; i < len; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const sb = db(); if (!sb) return [];
  const { data } = await sb.from("kv_store").select("data").eq("key", K_CAMPAIGNS).maybeSingle();
  return ((data?.data as Campaign[]) ?? []).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function saveCampaign(c: Campaign): Promise<void> {
  const sb = db(); if (!sb) throw new Error("KV 미설정");
  const all = await listCampaigns();
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c; else all.unshift(c);
  await sb.from("kv_store").upsert(
    { key: K_CAMPAIGNS, data: all, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  return (await listCampaigns()).find((c) => c.id === id) ?? null;
}

/**
 * 발송 대상 산출 — pp_shipments 의 **자사몰 직접 구매** 고객만.
 * @param sinceDays 최근 N일 이내 구매자(정보통신망법 제50조 단서: 직접 수집·6개월 이내·동종상품이면
 *                  사전 동의 없이 광고 전송 가능. 기본 180일로 그 안쪽만 담는다)
 * @param excludeProductNo 이미 그 상품을 산 사람은 제외하고 싶을 때
 */
export async function buildTargetsFromShipments(
  sinceDays = 180,
  opts: { excludeNameContains?: string[]; brand?: "paulvice" | "harriot" } = {},
): Promise<Array<{ name: string; phone: string; lastAt: string; orders: number }>> {
  const sb = db(); if (!sb) return [];
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const rows: Array<{ recipient_name: string; recipient_mobile: string; channel: string; created_at: string; product_name: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("pp_shipments")
      .select("recipient_name,recipient_mobile,channel,created_at,product_name")
      .eq("req_type", "1").eq("is_test", false).gte("created_at", since).range(from, from + 999);
    if (!data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
  }
  const map = new Map<string, { name: string; phone: string; lastAt: string; orders: number }>();
  for (const r of rows) {
    const allow = opts.brand ? OWN_CHANNELS_BY_BRAND[opts.brand] : OWN_CHANNELS;
    if (!allow.includes(r.channel)) continue;                 // ← 마켓 고객 차단 (+브랜드 좁히기)
    const phone = String(r.recipient_mobile || "").replace(/\D/g, "");
    if (!/^01[016789]\d{7,8}$/.test(phone)) continue;
    if (opts.excludeNameContains?.some((k) => (r.product_name || "").includes(k))) continue;
    const cur = map.get(phone);
    if (cur) { cur.orders++; if (r.created_at > cur.lastAt) cur.lastAt = r.created_at; }
    else map.set(phone, { name: r.recipient_name || "", phone, lastAt: r.created_at, orders: 1 });
  }
  return [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** 대상 명단을 캠페인에 등록하고 1인 1코드를 발급 */
export async function enrollTargets(
  campaignId: string,
  people: Array<{ name: string; phone: string }>,
): Promise<CampaignTarget[]> {
  const sb = db(); if (!sb) throw new Error("KV 미설정");
  const rows: CampaignTarget[] = people.map((p) => ({
    campaign_id: campaignId, code: makeCode(), name: p.name, phone: p.phone.replace(/\D/g, ""),
  }));
  const out: CampaignTarget[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await sb.from("crm_campaign_targets").insert(rows.slice(i, i + 200)).select();
    if (error) throw new Error(`대상 등록 실패: ${error.message}`);
    out.push(...((data as CampaignTarget[]) ?? []));
  }
  return out;
}

export async function getTargetByCode(code: string): Promise<CampaignTarget | null> {
  const sb = db(); if (!sb) return null;
  const { data } = await sb.from("crm_campaign_targets").select("*").eq("code", code).maybeSingle();
  return (data as CampaignTarget) ?? null;
}

/** 클릭 기록 — 첫 클릭 시각은 보존하고 횟수만 누적 */
export async function markClicked(code: string): Promise<CampaignTarget | null> {
  const sb = db(); if (!sb) return null;
  const t = await getTargetByCode(code);
  if (!t) return null;
  const now = new Date().toISOString();
  await sb.from("crm_campaign_targets").update({
    clicked_at: t.clicked_at || now,
    click_count: (t.click_count ?? 0) + 1,
  }).eq("code", code);
  return t;
}

/** 장바구니 담기 — pv-cart.js 가 쿠키(pv_c)의 코드를 실어 보낼 때 */
export async function markCart(code: string): Promise<void> {
  const sb = db(); if (!sb) return;
  const t = await getTargetByCode(code);
  if (!t || t.cart_at) return;
  await sb.from("crm_campaign_targets").update({ cart_at: new Date().toISOString() }).eq("code", code);
}

/** 구매 귀속 — 쿠폰 사용분이 정본, 없으면 전화번호 매칭(폴백) */
export async function markPurchase(
  code: string | null,
  phone: string | null,
  info: { orderId: string; revenue: number; attribution: "coupon" | "phone" | "click" },
): Promise<boolean> {
  const sb = db(); if (!sb) return false;
  let q = sb.from("crm_campaign_targets").update({
    purchased_at: new Date().toISOString(), order_id: info.orderId,
    revenue: info.revenue, attribution: info.attribution,
  }).is("purchased_at", null);
  q = code ? q.eq("code", code) : q.eq("phone", String(phone || "").replace(/\D/g, ""));
  const { data, error } = await q.select();
  return !error && !!data?.length;
}

export interface Funnel {
  targets: number; sent: number; delivered: number;
  clicked: number; carted: number; purchased: number;
  revenue: number; clickRate: number; cvr: number; roasNote: string;
}

export async function funnelOf(campaignId: string): Promise<Funnel> {
  const sb = db();
  const empty: Funnel = { targets: 0, sent: 0, delivered: 0, clicked: 0, carted: 0, purchased: 0, revenue: 0, clickRate: 0, cvr: 0, roasNote: "" };
  if (!sb) return empty;
  const rows: CampaignTarget[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("crm_campaign_targets").select("*").eq("campaign_id", campaignId).range(from, from + 999);
    if (!data?.length) break;
    rows.push(...(data as CampaignTarget[]));
    if (data.length < 1000) break;
  }
  const sent = rows.filter((r) => r.sent_at).length;
  const delivered = rows.filter((r) => r.send_status === "ok" || r.send_status === "delivered").length;
  const clicked = rows.filter((r) => r.clicked_at).length;
  const carted = rows.filter((r) => r.cart_at).length;
  const purchased = rows.filter((r) => r.purchased_at).length;
  const revenue = rows.reduce((a, r) => a + Number(r.revenue || 0), 0);
  return {
    targets: rows.length, sent, delivered, clicked, carted, purchased, revenue,
    clickRate: sent ? clicked / sent : 0,
    cvr: sent ? purchased / sent : 0,
    roasNote: sent ? `발송 1건당 매출 ${Math.round(revenue / sent).toLocaleString("ko-KR")}원` : "",
  };
}
