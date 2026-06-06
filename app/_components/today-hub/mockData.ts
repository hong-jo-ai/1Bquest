import type {
  Task, RevenueAction, RevenueGoal, BigEvent,
} from "./types";

// ── 외부 약속(구글 캘린더), 답장 필요(Gmail) 모두 v3 실연동 — mock 없음 ──

// 서버에 데이터가 없으면 실제 항목처럼 보이는 샘플 업무/이벤트를 만들지 않는다.
export const SEED_TASKS: Task[] = [];

/** 목표값만 기본 운영 설정으로 둔다. 루틴은 사용자가 직접 만들거나 자동 추천에서 생성한다. */
export const SEED_ROUTINES_PAULVICE: RevenueAction[] = [];

export const SEED_GOAL_PAULVICE: RevenueGoal = {
  target: 80_000_000,
  annualProfitTarget: 400_000_000,
  monthlyProfitTarget: 33_333_333,
  monthlyUnitsTarget: 1_000,
  annualLaunchTarget: 4,
  monthlyCampaignTarget: 2,
};
export const SEED_GOAL_HARRIOT: RevenueGoal = {
  target: 5_000_000,
  annualProfitTarget: 60_000_000,
  monthlyProfitTarget: 5_000_000,
  monthlyUnitsTarget: 20,
  annualLaunchTarget: 4,
  monthlyCampaignTarget: 1,
};

export const SEED_EVENTS_PAULVICE: BigEvent[] = [];
