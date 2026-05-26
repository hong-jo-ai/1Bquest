/**
 * 카페24 주문에서 SMS 수신 대상(수령인 휴대폰) 추출.
 *
 * 배송지연·AS 안내처럼 "특정 상품/배송상태 주문자들"에게 보낼 때 사용.
 * 취소·반품 건은 기본 제외. 동일 휴대폰은 1명으로 중복 제거(주문이 여러 건이면 합침).
 *
 * 주의: 주문 목록 API 의 `embed=items` 응답에는 수령인 연락처가 없다. 휴대폰/이름은
 * 별도 `receivers` 리소스에 있어 `embed=items,receivers` 로 함께 가져온다. 네이버페이
 * 주문도 receivers.cellphone 에 실번호가 채워진다(안심번호가 아님).
 */
import { cafe24Get } from "../cafe24Client";

export interface RecipientFilter {
  startDate: string;          // YYYY-MM-DD
  endDate: string;            // YYYY-MM-DD
  productNo?: number;         // 특정 상품만 (없으면 전체 주문)
  optionContains?: string;    // 옵션값 부분일치 (예: "실버")
  shipStatus?: string;        // 아이템 status_text 부분일치 (예: "배송보류")
  includeCanceled?: boolean;  // 취소·반품 포함 여부 (기본 false)
}

export interface Recipient {
  name: string;
  phone: string;              // 숫자만 (01012345678)
  orderIds: string[];
  sample: string;             // 매칭된 옵션/상태 미리보기
}

function normPhone(raw?: string | null): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  // 국가코드 82 → 0 보정
  if (d.startsWith("82")) return "0" + d.slice(2);
  return d;
}

/** items + receivers 를 함께 임베드해 페이징 조회. */
async function fetchOrdersWithReceivers(token: string, start: string, end: string): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const qs = new URLSearchParams({
      start_date: start, end_date: end,
      limit: String(limit), offset: String(offset),
      embed: "items,receivers",
    });
    const data = await cafe24Get(`/api/v2/admin/orders?${qs}`, token);
    const batch: any[] = data.orders ?? [];
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

export async function fetchRecipients(token: string, f: RecipientFilter): Promise<Recipient[]> {
  const all = await fetchOrdersWithReceivers(token, f.startDate, f.endDate);
  const byPhone = new Map<string, Recipient>();

  for (const o of all) {
    const items = (o.items ?? []) as any[];

    // 상품/옵션/상태 매칭 — 조건이 있으면 해당 라인이 하나라도 있어야 대상.
    const matched = items.filter((it) => {
      if (f.productNo && Number(it.product_no) !== f.productNo) return false;
      if (f.optionContains && !(it.option_value ?? "").includes(f.optionContains)) return false;
      if (f.shipStatus && !(it.status_text ?? "").includes(f.shipStatus)) return false;
      if (!f.includeCanceled) {
        const st = (it.status_text ?? "").toString();
        if (/취소|환불|반품/.test(st)) return false;
      }
      return true;
    });
    if (matched.length === 0) continue;

    // 수령인 연락처는 receivers 리소스에 있다 (목록 최상위엔 없음).
    const recv = (o.receivers ?? [])[0] ?? {};
    const phone = normPhone(recv.cellphone ?? recv.phone);
    if (!phone) continue;
    const name = (recv.name ?? o.billing_name ?? "고객").toString().trim() || "고객";
    const sample = (matched[0].option_value ?? matched[0].product_name ?? "")
      .replace(/^시계\s*모델\s*=\s*/, "").trim();

    const cur = byPhone.get(phone);
    if (cur) {
      if (o.order_id && !cur.orderIds.includes(o.order_id)) cur.orderIds.push(o.order_id);
    } else {
      byPhone.set(phone, { name, phone, orderIds: o.order_id ? [o.order_id] : [], sample });
    }
  }

  return [...byPhone.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
