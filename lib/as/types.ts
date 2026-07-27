import type { CsBrandId } from "../cs/types";

export type AsStatus =
  | "intake"     // 접수
  | "repairing"  // 수리중
  | "repaired"   // 수리완료
  | "notified"   // 비용·내역 안내완료
  | "shipped";   // 발송완료

export type AsDestination = "office" | "center";

// 처리유형: 수리/교환은 재발송(기존 흐름), 환불은 송금 흐름
export type AsRequestType = "repair" | "exchange" | "refund";

// 환불 진행: 환불대기 → 환불완료 (실제 송금은 수동)
export type AsRefundStatus = "pending" | "done";

export interface AsRequest {
  id: string;
  as_number: string;
  cs_thread_id: string | null;
  brand: CsBrandId;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  channel: string | null;
  model: string | null;
  symptom: string | null;
  destination: AsDestination | null;
  request_type: AsRequestType;
  status: AsStatus;
  repair_detail: string | null;
  repair_cost: number | null;
  return_tracking_no: string | null;
  // 환불(request_type='refund') 전용
  refund_amount: number | null;             // 실환불액(원)
  refund_shipping_deduction: number | null; // 배송비 공제(원)
  refund_account: string | null;            // 환불 계좌
  refund_status: AsRefundStatus | null;     // 환불대기/환불완료
  refunded_at: string | null;               // 환불완료 시각
  note: string | null;
  created_at: string;
  updated_at: string;
  shipped_at: string | null;
}

export const AS_STATUS_ORDER: AsStatus[] = [
  "intake",
  "repairing",
  "repaired",
  "notified",
  "shipped",
];

export const AS_STATUS_LABEL: Record<AsStatus, string> = {
  intake: "접수",
  repairing: "수리중",
  repaired: "수리완료",
  notified: "안내완료",
  shipped: "발송완료",
};

export const AS_DESTINATION_LABEL: Record<AsDestination, string> = {
  office: "사무실 (배터리 등 간단)",
  center: "수리센터 (성북구)",
};

export const AS_REQUEST_TYPE_LABEL: Record<AsRequestType, string> = {
  repair: "수리",
  exchange: "교환",
  refund: "환불",
};

export const AS_REFUND_STATUS_LABEL: Record<AsRefundStatus, string> = {
  pending: "환불대기",
  done: "환불완료",
};
