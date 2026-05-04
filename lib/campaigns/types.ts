export type CampaignBrand = "paulvice" | "harriot";

export interface Campaign {
  id:           string;
  name:         string;
  brand:        CampaignBrand;
  /** YYYY-MM-DD KST */
  startDate:    string;
  /** YYYY-MM-DD KST. null = 종료일 미정 (open-ended) */
  endDate:      string | null;
  /** 인플루언서 협업용으로 만든 Cafe24 상품 번호들 (product_no). 옵션은 상품 옵션으로 들어감. 주문 매칭의 1순위. */
  productNos?:  number[];
  /** 자체상품코드 메모 (BS01~BS17 등). 매칭에는 안 쓰이고 UI 식별용. productNos 와 같은 순서로 입력. */
  productCodes?: string[];
  /** (legacy) Cafe24 쿠폰 코드. productNos 가 비어있을 때만 fallback 매칭. */
  couponCode:   string | null;
  /** UTM 소스 (인플루언서 식별자). 공유 URL에 ?utm_source=… 로 첨부됨. */
  utmSource:    string;
  /** UTM 캠페인. 공유 URL에 ?utm_campaign=… */
  utmCampaign:  string;
  /** 랜딩 베이스 URL (예: https://paulvice.kr/). 공유 URL은 이 + UTM 파라미터 */
  landingUrl:   string;
  notes?:       string;
}

export interface CampaignBuyer {
  orderId:    string;
  email:      string | null;
  phone:      string | null;
  name:       string | null;
  amount:     number;
  orderedAt:  string;
}

export interface CampaignMetrics {
  campaignId:    string;
  windowStart:   string; // 조회한 시작일
  windowEnd:     string; // 조회한 종료일 (오늘 또는 endDate)
  ordersCount:   number;
  revenue:       number;
  avgOrder:      number;
  buyers:        CampaignBuyer[];
  /** 매칭 방식 안내 — UI 에 표시 */
  matchedBy:     "product" | "coupon" | "none";
  /** 쿠폰 정보가 주문에서 발견 안 된 경우 등 사용자 안내 */
  warning?:      string;
}
