export type TrustLevel = "untrusted" | "learning" | "trusted" | "decaying";

export type ActionType =
  | "increase"
  | "decrease"
  | "pause"
  | "duplicate"
  | "creative_refresh"
  | "hold";

export type RecStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "ignored"
  | "expired"
  | "superseded";

export type FunnelStage = "prospecting" | "retargeting" | "unknown";

export interface DailyMetric {
  date: string; // YYYY-MM-DD
  spend: number;
  revenue: number;
  conversions: number;
  impressions: number;
  clicks: number;
  ctr: number;
  largestOrderValue: number;
  isProvisional: boolean;
  cpm?: number | null;
  frequency?: number | null;
  reach?: number | null;
}

/** 개별 광고(소재) 레지스트리 — 현황판용. */
export interface AdSummary {
  metaAdId: string;
  metaAdsetId: string;
  metaAccountId: string;
  name: string;
  effectiveStatus: string;
  creativeFormat: "video" | "image" | "unknown";
  thumbnailUrl: string | null;
}

/** 개별 광고 일별 인사이트. */
export interface AdDailyMetric {
  metaAdId: string;
  date: string;
  spend: number;
  revenue: number;
  conversions: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  frequency: number | null;
  reach: number | null;
}

export interface AdSetSummary {
  metaAdsetId: string;
  metaAccountId: string;
  accountName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  campaignObjective: string | null;
  name: string;
  status: string;
  dailyBudget: number | null; // KRW
  funnelStage: FunnelStage;
  lastBudgetChangeAt: string | null;
  creativeFormats?: string[] | null; // ["video"], ["image"], ["video","image"] — 활성 광고 소재 포맷
}

export interface TrustEvaluation {
  level: TrustLevel;
  conversions7d: number;
  spend7d: number;
  revenue7d: number;
  roas7d: number;
  roas3d: number;
  adjustedRoas7d: number;
  largestOrderShare: number;
  prevRoas7d: number | null;
  reason: string;
}

export interface Warning {
  code:
    | "wobble"
    | "large_order_distortion"
    | "recent_budget_change"
    | "low_conversions"
    | "data_gap";
  message: string;
}

export interface Recommendation {
  actionType: ActionType;
  currentBudget: number | null;
  recommendedBudget: number | null;
  deltaPct: number | null;
  reason: string;
  warnings: Warning[];
  trust: TrustEvaluation;
}
