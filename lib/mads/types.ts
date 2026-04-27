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
