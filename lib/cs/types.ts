import type { BrandId } from "../threadsBrands";

export type CsBrandId = Extract<BrandId, "paulvice" | "harriot">;

export type CsChannel =
  | "gmail"
  | "threads"
  | "ig_dm"
  | "ig_comment"
  | "channeltalk"
  | "crisp"
  | "kakao_bizchat"
  | "cafe24_board"
  | "sixshop_board"
  | "reddit"
  | "sixshop"
  | "wconcept";

export type CsStatus = "unanswered" | "waiting" | "resolved" | "archived";
export type CsDirection = "in" | "out";

// 인박스 항목 종류: 대화형 문의 vs 반품/교환 라이프사이클 카드
export type CsItemType = "inquiry" | "return";

export interface CsThread {
  id: string;
  brand: CsBrandId;
  channel: CsChannel;
  external_thread_id: string;
  customer_handle: string | null;
  customer_name: string | null;
  subject: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  status: CsStatus;
  priority: number;
  item_type: CsItemType;
  created_at: string;
  updated_at: string;
}

// 반품/교환/취소 클레임 (cs_returns, cs_threads 와 1:1)
export type CsReturnStatus =
  | "requested"   // 신청 — 확인 필요
  | "confirmed"   // 수락됨 (수거 시작 전)
  | "in_transit"  // 회수 중
  | "received"    // 회수 도착 — 완료 처리 가능
  | "done"        // 완료
  | "rejected";   // 거부

export type CsClaimType = "return" | "exchange" | "cancel";

export interface CsReturn {
  id: string;
  thread_id: string;
  channel: CsChannel;
  order_number: string;
  claim_type: CsClaimType;
  product: string | null;
  reason: string | null;
  customer_name: string | null;
  recovery_tracking_no: string | null;
  status: CsReturnStatus;
  raw: unknown;
  created_at: string;
  updated_at: string;
}

export interface CsMessage {
  id: string;
  thread_id: string;
  direction: CsDirection;
  external_message_id: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string;
  raw: unknown;
  created_at: string;
}

export interface IngestPayload {
  brand: CsBrandId;
  channel: CsChannel;
  externalThreadId: string;
  externalMessageId?: string;
  customerHandle?: string;
  customerName?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  sentAt: Date;
  direction: CsDirection;
  raw?: unknown;
}

export const CHANNEL_LABEL: Record<CsChannel, string> = {
  gmail: "Gmail",
  threads: "Threads",
  ig_dm: "IG DM",
  ig_comment: "IG 댓글",
  channeltalk: "채널톡",
  crisp: "Crisp",
  kakao_bizchat: "카카오 상담톡",
  cafe24_board: "카페24 게시판",
  sixshop_board: "식스샵 게시판",
  reddit: "Reddit",
  sixshop: "식스샵",
  wconcept: "W컨셉",
};

export const BRAND_LABEL: Record<CsBrandId, string> = {
  paulvice: "폴바이스",
  harriot: "해리엇",
};

// 반품 클레임 종류/상태 한글 라벨
export const CLAIM_TYPE_LABEL: Record<CsClaimType, string> = {
  return: "반품",
  exchange: "교환",
  cancel: "취소",
};

export const RETURN_STATUS_LABEL: Record<CsReturnStatus, string> = {
  requested: "신청 — 확인 필요",
  confirmed: "수락됨",
  in_transit: "회수 중",
  received: "회수 도착",
  done: "완료",
  rejected: "거부",
};
