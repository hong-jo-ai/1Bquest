/**
 * 카페24 무통장입금(cash) 주문 입금확인 처리.
 *
 * 카페24 API 메모(이 몰/버전 2026-03-01 기준 실측):
 *   - 주문상태는 항목(item) 단위. `PUT /orders/{id}/items` 는 이 앱에서 403(Invalid API).
 *   - `PUT /orders/{id}` 가 `order_item_code[]` + `process_status` 를 받아 상태 전환.
 *   - 입금전(N00) → 상품준비중(N10) 전환값이 `process_status: "prepare"`.
 *     (무통장 주문을 상품준비중으로 올리면 카페24가 입금확인으로 처리 = payment_date 기록)
 *
 * 안전성: process_status 값이 거부되면(잘못된 enum/불가 전환) PUT 이 4xx 로 떨어지고
 *   주문은 입금전 그대로 유지된다. 호출부는 ok=false 를 받아 "수동 확인" 으로 폴백한다.
 */
import { cafe24Get, cafe24Put } from "../cafe24Client";

/** 입금전 상태코드 (카페24 order_status). */
const UNPAID_STATUS = "N00";
/** 입금확인 → 상품준비중 전환값. */
const CONFIRM_PROCESS_STATUS = "prepare";

interface OrderItem {
  order_item_code?: string;
  order_status?: string;
  product_name?: string;
}

export interface ConfirmResult {
  ok: boolean;
  /** 입금확인 처리된 항목 수. */
  confirmed: number;
  /** 이미 입금확인된(입금전 항목 없음) 주문이면 true. */
  alreadyConfirmed?: boolean;
  /** 처리 후 검증된 주문상태(첫 항목). */
  statusAfter?: string;
  error?: string;
}

async function fetchItems(token: string, orderId: string): Promise<OrderItem[]> {
  const json = (await cafe24Get(
    `/api/v2/admin/orders/${orderId}/items`,
    token,
  )) as { items?: OrderItem[] };
  return json.items ?? [];
}

/**
 * 단일 주문을 입금확인 처리한다. 입금전(N00) 항목만 대상으로 한다.
 *
 * @returns ok=true 면 확정 성공(또는 이미 확정됨). ok=false 면 미처리(주문 변경 없음).
 */
export async function confirmOrderPayment(
  token: string,
  orderId: string,
  shopNo = 1,
): Promise<ConfirmResult> {
  let items: OrderItem[];
  try {
    items = await fetchItems(token, orderId);
  } catch (e) {
    return { ok: false, confirmed: 0, error: `항목 조회 실패: ${msg(e)}` };
  }

  const unpaidCodes = items
    .filter((it) => it.order_status === UNPAID_STATUS && it.order_item_code)
    .map((it) => it.order_item_code as string);

  if (unpaidCodes.length === 0) {
    return { ok: true, confirmed: 0, alreadyConfirmed: true };
  }

  try {
    await cafe24Put(`/api/v2/admin/orders/${orderId}`, token, {
      shop_no: shopNo,
      request: {
        order_item_code: unpaidCodes,
        process_status: CONFIRM_PROCESS_STATUS,
      },
    });
  } catch (e) {
    // process_status 거부/전환 불가 등 → 주문은 입금전 그대로. 수동 폴백.
    return { ok: false, confirmed: 0, error: `입금확인 PUT 실패: ${msg(e)}` };
  }

  // 검증: 다시 읽어 입금전이 사라졌는지 확인.
  try {
    const after = await fetchItems(token, orderId);
    const stillUnpaid = after.some((it) => it.order_status === UNPAID_STATUS);
    const statusAfter = after[0]?.order_status;
    if (stillUnpaid) {
      return {
        ok: false,
        confirmed: 0,
        statusAfter,
        error: "PUT 응답은 성공이나 입금전 상태가 유지됨",
      };
    }
    return { ok: true, confirmed: unpaidCodes.length, statusAfter };
  } catch {
    // 검증 실패해도 PUT 자체는 성공했으므로 확정으로 간주.
    return { ok: true, confirmed: unpaidCodes.length };
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
