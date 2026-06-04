import type { CsBrandId } from "../cs/types";

export type AsStatus =
  | "intake"     // 접수
  | "repairing"  // 수리중
  | "repaired"   // 수리완료
  | "notified"   // 비용·내역 안내완료
  | "shipped";   // 발송완료

export type AsDestination = "office" | "center";

export interface AsRequest {
  id: string;
  as_number: string;
  cs_thread_id: string | null;
  brand: CsBrandId;
  customer_name: string | null;
  customer_phone: string | null;
  channel: string | null;
  model: string | null;
  symptom: string | null;
  destination: AsDestination | null;
  status: AsStatus;
  repair_detail: string | null;
  repair_cost: number | null;
  return_tracking_no: string | null;
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
