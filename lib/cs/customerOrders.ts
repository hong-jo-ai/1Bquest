/**
 * CS 문의 고객 ↔ 과거 주문 매칭.
 *
 * 우체국 송장 자동입력용으로 모든 채널(카페24·식스샵·29CM·W컨셉·무신사·카카오선물)의
 * per-주문 수령인 정보가 pp_shipments 에 적재돼 있다(실명·실휴대폰·상품·채널·날짜·운송장).
 * 이를 문의 고객의 전화번호/이름으로 조회해 "언제·어떤 채널에서·어떤 상품을 샀는지" 보여준다.
 *
 * 전화번호는 채널마다 포맷(하이픈 유무)이 달라 SQL 에서 정규화가 안 되므로,
 * 끝 4자리 ilike 로 후보를 추린 뒤 앱에서 숫자만 비교해 완전일치만 채택한다.
 */
import { getCsSupabase } from "./store";

export interface CustomerOrder {
  channel: string;
  orderNumber: string;
  productName: string;
  qty: number | null;
  date: string | null; // registered_at ?? created_at
  tracking: string | null; // 운송장(등기)번호
  status: string | null;
  reqType: string; // '1' 출고 / '2' 반품
  matchedBy: "phone" | "name";
}

export interface CustomerOrderHistory {
  phone: string | null;
  totalOrders: number;
  channels: string[];
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  orders: CustomerOrder[];
  nameOnlyCount: number; // 이름만 일치(전화 불일치 가능) 건수
}

interface ShipRow {
  channel: string;
  order_number: string;
  product_name: string | null;
  qty: number | null;
  registered_at: string | null;
  created_at: string | null;
  regi_no: string | null;
  status: string | null;
  req_type: string | null;
  recipient_mobile: string | null;
  recipient_tel: string | null;
  recipient_name: string | null;
}

const COLS =
  "channel, order_number, product_name, qty, registered_at, created_at, regi_no, status, req_type, recipient_mobile, recipient_tel, recipient_name";

export function normalizePhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("82")) d = "0" + d.slice(2);
  return d.length >= 9 ? d : null;
}

function rowToOrder(r: ShipRow, matchedBy: "phone" | "name"): CustomerOrder {
  return {
    channel: r.channel,
    orderNumber: r.order_number,
    productName: (r.product_name ?? "").trim(),
    qty: r.qty ?? null,
    date: r.registered_at ?? r.created_at ?? null,
    tracking: r.regi_no ?? null,
    status: r.status ?? null,
    reqType: r.req_type ?? "1",
    matchedBy,
  };
}

export async function getCustomerOrderHistory(input: {
  phone?: string | null;
  name?: string | null;
}): Promise<CustomerOrderHistory> {
  const db = getCsSupabase();
  const phone = normalizePhone(input.phone);
  const name = (input.name ?? "").trim();

  const byKey = new Map<string, CustomerOrder>();
  const keyOf = (r: ShipRow) => `${r.channel}|${r.order_number}|${r.req_type}`;

  // 1) 전화번호 매칭 — 끝 4자리로 후보 추린 뒤 숫자 완전일치만 채택
  if (phone) {
    const last4 = phone.slice(-4);
    const { data } = await db
      .from("pp_shipments")
      .select(COLS)
      .or(`recipient_mobile.ilike.%${last4}%,recipient_tel.ilike.%${last4}%`)
      .order("registered_at", { ascending: false })
      .limit(400);
    for (const r of (data ?? []) as ShipRow[]) {
      const rp = normalizePhone(r.recipient_mobile) ?? normalizePhone(r.recipient_tel);
      if (rp !== phone) continue;
      const k = keyOf(r);
      if (!byKey.has(k)) byKey.set(k, rowToOrder(r, "phone"));
    }
  }

  // 2) 이름 매칭 — 공백 제거 정확 일치만, 전화로 못 잡은 주문만 보조 표시
  let nameOnlyCount = 0;
  if (name.length >= 2) {
    const { data } = await db
      .from("pp_shipments")
      .select(COLS)
      .ilike("recipient_name", `%${name}%`)
      .order("registered_at", { ascending: false })
      .limit(100);
    const target = name.replace(/\s/g, "");
    for (const r of (data ?? []) as ShipRow[]) {
      if ((r.recipient_name ?? "").replace(/\s/g, "") !== target) continue;
      const k = keyOf(r);
      if (byKey.has(k)) continue; // 이미 전화로 잡힘
      byKey.set(k, rowToOrder(r, "name"));
      nameOnlyCount += 1;
    }
  }

  const orders = [...byKey.values()].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? ""),
  );
  const dates = orders.map((o) => o.date).filter((d): d is string => !!d);
  const channels = [...new Set(orders.map((o) => o.channel))];

  return {
    phone,
    totalOrders: orders.length,
    channels,
    firstOrderDate: dates.length ? dates[dates.length - 1] : null,
    lastOrderDate: dates.length ? dates[0] : null,
    orders,
    nameOnlyCount,
  };
}
