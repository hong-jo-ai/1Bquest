/**
 * 카페24 배송완료 자동 전환 — 실제로 배달된 주문을 언제까지나 "배송중"에 두지 않는다.
 *
 * 문제(2026-08-30 실측): 최근 20일 폴바이스 카페24 주문 중 N30(배송중) 41건이
 * **41건 전부** 우체국 종추적상 이미 배달완료였다. 카페24는 우체국 배송상태를
 * 스스로 당겨오지 않아 송장만 등록된 채 멈춰 있다. 그 대가가 둘이다.
 *   - 고객: 배송중이라 교환·반품 신청 버튼이 안 열린다.
 *   - 우리: 구매확정이 안 걸려 정산이 밀린다.
 * 우리는 이미 `pp_shipments.tracking_state` 에 배달완료를 갖고 있으니, 옮기기만 하면 된다.
 *
 * API: PUT /admin/orders/{order_id}/shipments/{shipping_code}
 *      body { shop_no, request: { status: "shipped" } }   ← "shipped" = 배송완료(N40)
 *      (배송중은 "shipping". 송장번호·택배사는 보내지 않아도 지워지지 않는다 — 실측 확인)
 *
 * ⚠️ **네이버페이 주문은 불가.** API 가 422 "Naver Pay order is unable to process
 *    'delivered' status." 로 거절한다. 네이버가 배송상태를 쥐고 있어 카페24가 손대지 못한다.
 *    최근 20일 기준 41건 중 15건이 여기 해당 — 이건 우리가 못 고치는 영역이라
 *    조용히 넘기지 말고 건수를 따로 보고한다.
 */
import { getValidC24Token } from "@/lib/cafe24Auth";
import type { MallId } from "@/lib/cafe24Client";
import { createClient } from "@supabase/supabase-js";

const API_VERSION = "2026-03-01";

/** 몰 ↔ pp_shipments.channel. 발송기록은 몰 이름이 아니라 채널명으로 적재된다. */
const CHANNELS: Record<MallId, string[]> = {
  paulvice: ["카페24"],
  harriot: ["해리엇", "해리엇와치스"],
};

function mallIdEnv(mall: MallId): string {
  return (mall === "harriot" ? process.env.HARRIOT_CAFE24_MALL_ID : process.env.CAFE24_MALL_ID) || "";
}

interface OrderItem {
  order_status?: string;
  naver_pay_order_id?: string | null;
  order_item_code?: string;
}
interface Order {
  order_id: string;
  payment_date?: string;
  payment_method_name?: string;
  canceled?: string;
  items?: OrderItem[];
}

export interface FlipResult {
  mall: MallId;
  /** 배송중 상태로 조회된 주문 */
  shipping: number;
  /** 그중 종추적상 배달완료 */
  delivered: number;
  /** 실제로 배송완료 처리한 건 */
  flipped: number;
  /** 네이버페이라 API 로 못 바꾸는 건 — 관리자에서 수동이거나 네이버 쪽 반영 대기 */
  naverPay: number;
  /** 그중 배달완료된 지 오래됐는데도 안 풀린 건 — 네이버 판매자센터에서 밀어야 한다 */
  naverPayStale: string[];
  /** 종추적 기록이 없어 판단 불가 */
  noTracking: number;
  failed: Array<{ orderId: string; reason: string }>;
  orders: string[];
  dryRun: boolean;
}

const isNaverPay = (o: Order) =>
  (o.items ?? []).some((i) => !!i.naver_pay_order_id) || /네이버/.test(o.payment_method_name ?? "");

/**
 * @param mall 대상 몰
 * @param opts.days 조회 기간(결제일 기준). 배송이 길어야 일주일이라 14일이면 충분하고,
 *                  넓히면 주문 API 페이지 수만 늘어난다.
 * @param opts.confirm false 면 무엇을 바꿀지만 계산하고 쓰지 않는다.
 */
export async function flipDeliveredOrders(
  mall: MallId,
  opts: { days?: number; confirm?: boolean; limit?: number } = {},
): Promise<FlipResult> {
  // 카페24 주문 조회는 조회기간 3개월 상한이 있다(초과 시 422). 넘겨받아도 잘라서 부른다.
  const days = Math.min(opts.days ?? 14, 88);
  const dryRun = !opts.confirm;
  const out: FlipResult = {
    mall, shipping: 0, delivered: 0, flipped: 0, naverPay: 0, naverPayStale: [],
    noTracking: 0, failed: [], orders: [], dryRun,
  };

  const token = await getValidC24Token(mall);
  if (!token) throw new Error(`${mall} 카페24 토큰 없음`);
  const base = `https://${mallIdEnv(mall)}.cafe24api.com/api/v2/admin`;
  const H: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Cafe24-Api-Version": API_VERSION,
    "Content-Type": "application/json",
  };

  // ① 배송중 주문 수집
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const shipping: Order[] = [];
  for (let page = 1; page <= 20; page++) {
    const u = `${base}/orders?start_date=${start}&end_date=${end}&limit=100&offset=${(page - 1) * 100}`
      + `&embed=items&date_type=pay_date`;
    const r = await fetch(u, { headers: H });
    if (!r.ok) throw new Error(`주문 조회 실패 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const orders = ((await r.json()) as { orders?: Order[] }).orders ?? [];
    for (const o of orders) {
      if (o.canceled === "T") continue;
      // 배송중 품목이 하나라도 있으면 대상. 취소·반품·교환 품목이 섞인 주문은
      // 그 품목만 다른 상태로 남고, 우리가 건드리는 건 배송중 품목뿐이다.
      if ((o.items ?? []).some((i) => i.order_status === "N30")) shipping.push(o);
    }
    if (orders.length < 100) break;
  }
  out.shipping = shipping.length;
  if (!shipping.length) return out;

  // ② 우리 종추적과 대조 — 배달완료만 통과
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ids = shipping.map((o) => o.order_id);
  const tracked = new Map<string, { state: string | null; regi: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("pp_shipments")
      .select("order_number,tracking_state,regi_no")
      .in("order_number", ids.slice(i, i + 200))
      .in("channel", CHANNELS[mall])
      .eq("req_type", "1").eq("is_test", false);
    for (const r of (data ?? []) as Array<{ order_number: string; tracking_state: string | null; regi_no: string | null }>) {
      // 같은 주문에 여러 소포가 있으면 **전부 배달완료**여야 한다. 하나라도 배송중이면 아직이다.
      const cur = tracked.get(r.order_number);
      const done = r.tracking_state === "배달완료";
      tracked.set(r.order_number, {
        state: cur ? (cur.state === "배달완료" && done ? "배달완료" : "미완료") : (done ? "배달완료" : "미완료"),
        regi: cur?.regi ?? r.regi_no,
      });
    }
  }

  const targets: Order[] = [];
  for (const o of shipping) {
    const t = tracked.get(o.order_id);
    if (!t) { out.noTracking++; continue; }
    if (t.state !== "배달완료") continue;
    if (isNaverPay(o)) {
      out.naverPay++;
      // 네이버페이는 보통 며칠 안에 네이버 쪽에서 배송완료로 넘어간다. 일주일이 넘도록
      // 안 풀렸으면 스스로 안 풀릴 가능성이 크니 사람이 판매자센터에서 처리해야 한다.
      const paid = o.payment_date ? new Date(o.payment_date).getTime() : 0;
      if (paid && Date.now() - paid > 7 * 86400000) out.naverPayStale.push(o.order_id);
      continue;
    }
    targets.push(o);
  }
  out.delivered = targets.length + out.naverPay;
  const limited = opts.limit ? targets.slice(0, opts.limit) : targets;
  if (opts.limit && targets.length > limited.length) {
    out.failed.push({ orderId: "-", reason: `limit ${opts.limit} 로 ${targets.length - limited.length}건 이월` });
  }

  // ③ 전환
  for (const o of limited) {
    if (dryRun) { out.orders.push(o.order_id); continue; }
    try {
      const s = await fetch(`${base}/orders/${o.order_id}/shipments`, { headers: H });
      const codes = ((await s.json()) as { shipments?: Array<{ shipping_code: string; items?: Array<{ status?: string }> }> }).shipments ?? [];
      let touched = false;
      for (const c of codes) {
        // 이미 shipped 인 배송건은 건너뛴다(중복 호출 방지 — 재실행이 안전해야 한다).
        if (!(c.items ?? []).some((i) => i.status === "shipping")) continue;
        const r = await fetch(`${base}/orders/${o.order_id}/shipments/${c.shipping_code}`, {
          method: "PUT", headers: H,
          body: JSON.stringify({ shop_no: 1, request: { status: "shipped" } }),
        });
        if (!r.ok) {
          out.failed.push({ orderId: o.order_id, reason: `${r.status} ${(await r.text()).slice(0, 160)}` });
        } else touched = true;
      }
      if (touched) { out.flipped++; out.orders.push(o.order_id); }
    } catch (e) {
      out.failed.push({ orderId: o.order_id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
