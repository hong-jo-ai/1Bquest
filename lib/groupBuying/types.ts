// ── 공동구매 타입 & 설정 ─────────────────────────────────────────────

export type GbStatus =
  | "proposal"        // 발굴/제안
  | "negotiating"     // 협의중
  | "confirmed"       // 조건확정
  | "active"          // 공구진행중
  | "shipped"         // 발송완료
  | "pending_settle"  // 정산대기
  | "settled"         // 정산완료
  | "analyzed";       // 성과분석

export type OrderMode = "cafe24" | "purchase_order";

export type ShippingStatus =
  | "pending"
  | "preparing"
  | "shipped"
  | "delivered"
  | "returned";

export const GB_STATUS_CONFIG: Record<
  GbStatus,
  { label: string; color: string; bg: string; border: string; next: GbStatus | null }
> = {
  proposal:       { label: "발굴/제안",  color: "text-zinc-600",   bg: "bg-zinc-100",    border: "border-zinc-200",  next: "negotiating" },
  negotiating:    { label: "협의중",     color: "text-amber-600",  bg: "bg-amber-50",    border: "border-amber-200", next: "confirmed" },
  confirmed:      { label: "조건확정",   color: "text-blue-600",   bg: "bg-blue-50",     border: "border-blue-200",  next: "active" },
  active:         { label: "공구진행중", color: "text-violet-600", bg: "bg-violet-50",   border: "border-violet-200",next: "shipped" },
  shipped:        { label: "발송완료",   color: "text-indigo-600", bg: "bg-indigo-50",   border: "border-indigo-200",next: "pending_settle" },
  pending_settle: { label: "정산대기",   color: "text-orange-600", bg: "bg-orange-50",   border: "border-orange-200",next: "settled" },
  settled:        { label: "정산완료",   color: "text-emerald-600",bg: "bg-emerald-50",  border: "border-emerald-200",next: "analyzed" },
  analyzed:       { label: "성과분석",   color: "text-teal-600",   bg: "bg-teal-50",     border: "border-teal-200",  next: null },
};

export function getInfluencerProfileUrl(
  handle: string | null | undefined,
  platform: string | null | undefined,
): string | null {
  if (!handle) return null;
  const h = handle.trim().replace(/^@+/, "");
  if (!h) return null;
  switch ((platform ?? "").toLowerCase()) {
    case "instagram": return `https://www.instagram.com/${h}/`;
    case "youtube":   return `https://www.youtube.com/@${h}`;
    case "tiktok":    return `https://www.tiktok.com/@${h}`;
    case "threads":   return `https://www.threads.com/@${h}`;
    default:          return `https://www.instagram.com/${h}/`;
  }
}

export const SHIPPING_STATUS_CONFIG: Record<
  ShippingStatus,
  { label: string; color: string }
> = {
  pending:    { label: "대기",   color: "text-zinc-500" },
  preparing:  { label: "준비중", color: "text-amber-600" },
  shipped:    { label: "발송",   color: "text-blue-600" },
  delivered:  { label: "배달완료", color: "text-emerald-600" },
  returned:   { label: "반품",   color: "text-red-600" },
};

// ── 인터페이스 ───────────────────────────────────────────────────────

export interface GbCampaign {
  id: string;
  influencer_handle: string;
  influencer_name: string | null;
  influencer_platform: string | null;
  influencer_followers: number | null;
  title: string;
  status: GbStatus;
  start_date: string | null;
  end_date: string | null;
  commission_rate: number | null;
  commission_type: "rate" | "fixed_per_unit";
  commission_fixed_amount: number | null;
  order_mode: OrderMode;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // 집계 (API 조인 시)
  products?: GbProduct[];
  order_count?: number;
  total_revenue?: number;
  total_quantity?: number;
}

export interface GbProduct {
  id: string;
  campaign_id: string;
  product_sku: string | null;
  product_name: string;
  product_image: string | null;
  original_price: number | null;
  discount_price: number | null;
  allocated_stock: number;
  created_at: string;
  updated_at: string;
}

export interface GbOrder {
  id: string;
  campaign_id: string;
  product_id: string | null;
  cafe24_order_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  product_name: string | null;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  shipping_status: ShippingStatus;
  tracking_number: string | null;
  tracking_carrier: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  is_returned: boolean;
  return_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface GbSettlement {
  id: string;
  campaign_id: string;
  total_revenue: number;
  total_quantity: number;
  return_amount: number;
  net_revenue: number;
  commission_amount: number;
  shipping_cost: number;
  product_cost: number;
  net_profit: number;
  settled_at: string | null;
  receipt_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface GbPriceCheck {
  id: string;
  campaign_id: string;
  channel: string;
  price: number;
  checked_at: string;
  is_lowest: boolean;
  notes: string | null;
}
