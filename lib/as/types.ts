import type { CsBrandId } from "../cs/types";

export type AsStatus =
  | "intake"     // 접수
  | "repairing"  // 수리중
  | "repaired"   // 수리완료
  | "notified"   // 비용·내역 안내완료
  | "shipped";   // 발송완료

// office/center 는 시계 전용. 주얼리(팔찌·목걸이·반지·귀걸이)는 공급처 나비스트로 간다.
export type AsDestination = "office" | "center" | "jewelry";

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
  jewelry: "주얼리 (나비스트·중구)",
};

/** AS 회송지 실주소 — 고객 안내문에 그대로 쓰는 값. */
export const AS_DESTINATION_ADDRESS: Record<AsDestination, { recipient: string; addr: string; tel: string }> = {
  office: {
    recipient: "[브랜드명] AS센터",
    addr: "경기도 용인시 기흥구 중부대로 184 힉스유타워 717-2",
    tel: "070-4571-4944",
  },
  center: {
    recipient: "[브랜드명] AS",
    addr: "서울특별시 성북구 화랑로37길 42(장위동) 삼익상가 2층 206호",
    tel: "010-3709-2386",
  },
  jewelry: {
    recipient: "나비스트",
    addr: "서울시 중구 퇴계로4길 38 영우빌딩 #202",
    tel: "02-773-1244",
  },
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
