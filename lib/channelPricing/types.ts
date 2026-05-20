import type { ChannelId } from "../multiChannelData";

/** 가격 관리 대상 채널 (cafe24 = 기준 마스터). */
export type PricingChannel = "cafe24" | "wconcept" | "musinsa" | "29cm" | "kakao_gift";

export const PRICING_CHANNELS: PricingChannel[] = [
  "cafe24",
  "wconcept",
  "musinsa",
  "29cm",
  "kakao_gift",
];

export const PRICING_CHANNEL_LABEL: Record<PricingChannel, string> = {
  cafe24: "카페24",
  wconcept: "W컨셉",
  musinsa: "무신사",
  "29cm": "29CM",
  kakao_gift: "카카오선물",
};

/** 채널 상품목록 엑셀에서 추출한 정규화 행. */
export interface NormalizedChannelProduct {
  /** 채널 내부 상품코드 (우리 SKU 아님) */
  channelCode: string;
  /** 채널 상품명 (매칭용) */
  name: string;
  image?: string | null;
  /** 정가 */
  list: number | null;
  /** 할인 적용가 (고객 결제가) */
  discount: number | null;
  /** 우리 실수령액 (정산 net) — 채널마다 산출식 다름 */
  net: number | null;
  /** 판매상태 텍스트 (판매중/품절/임시저장 등) */
  status?: string | null;
}

export interface ChannelParseResult {
  channel: PricingChannel;
  products: NormalizedChannelProduct[];
  warnings: string[];
}

export type PriceSource = "api" | "excel" | "skumap" | "manual";

/** 한 SKU의 한 채널 가격 셀. */
export interface ChannelPriceCell {
  list: number | null;
  discount: number | null;
  net: number | null;
  source: PriceSource;
  channelCode?: string | null;
  status?: string | null;
  updatedAt: string;
}

/** 카탈로그 1행 = canonical SKU (= cafe24 product_code) 기준. */
export interface CatalogEntry {
  sku: string;
  name: string;
  image?: string | null;
  channels: Partial<Record<PricingChannel, ChannelPriceCell>>;
}

export interface PricingCatalog {
  entries: Record<string, CatalogEntry>; // key = sku
  updatedAt: string;
}

/** 채널 내부코드 → 우리 SKU 매핑 (수동 확인으로 누적). */
export type ChannelSkuMap = Record<string, string>; // channelCode → sku

/** 자동 매칭 실패해 사용자 확인이 필요한 채널 상품. */
export interface UnmatchedChannelProduct {
  channel: PricingChannel;
  channelCode: string;
  name: string;
  image?: string | null;
  list: number | null;
  discount: number | null;
  net: number | null;
  /** 이름 유사도 상위 후보 SKU들 */
  candidates: Array<{ sku: string; name: string; score: number }>;
}

export type { ChannelId };
