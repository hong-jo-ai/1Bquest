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
  | "naver_qna";

export type CsStatus = "unanswered" | "waiting" | "resolved" | "archived";
export type CsDirection = "in" | "out";

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
  naver_qna: "네이버 Q&A",
};

export const BRAND_LABEL: Record<CsBrandId, string> = {
  paulvice: "폴바이스",
  harriot: "해리엇",
};
