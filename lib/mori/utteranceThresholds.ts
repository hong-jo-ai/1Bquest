/**
 * 모리 능동 발화(proactive utterance) 임계값 — SSOT.
 *
 * Week 3의 백그라운드 임계값 워커가 이 설정을 읽어 "모리가 먼저 말 걸지" 판정한다.
 * (2026-05-27 사용자 확정. 근거: 하루 ≈ 2.6건 매출 볼륨, MADS가 이미 ROAS 판정 중,
 *  "광고는 흔들지 않는다" + "가족시간 존중" 운영 헌법.)
 *
 * 설계 원칙:
 *  - 광고는 MADS 판단을 모리가 "전달"만 한다. ROAS 출렁임마다 떠들지 않는다(중복/잔소리 방지).
 *  - 매출 무발생·CS 미답변은 본질적으로 업무시간 한정 신호다(새벽 무주문/야간 미답변은 정상).
 *  - 조용 모드(업무시간 외/주말)에는 '긴급'만 울린다. 긴급 = 광고 pause(예산 새는 것)뿐.
 */

import type { ActionType } from "@/lib/mads/types";

export type MoriMode = "office" | "quiet";

/** 능동 발화 신호 종류. */
export type UtteranceSignalType = "ads" | "sales" | "cs";

export interface UtteranceThresholds {
  /** 광고 — MADS 신규 추천 발생 시 발화. */
  ads: {
    /** 발화 대상 액션. 'hold'는 손댈 거리 아님 → 제외. */
    actionableTypes: ActionType[];
    /** 이 중 하나면 '긴급' = 조용 모드에서도 울림(돈 새는 것). */
    urgentTypes: ActionType[];
  };
  /** 매출 무발생 — 사무시간(평일 08-19시)에만 의미. */
  sales: {
    /** 이 시간(시) 동안 신규 주문 0이면 발화. */
    noSaleHours: number;
    /** 사무시간 한정. 조용 모드에선 발화 안 함. */
    officeOnly: true;
  };
  /** CS — 새 미답변 발생 기준. */
  cs: {
    /** 미답변이 이 수 이상이면 발화(1 = 생기면 즉시). */
    minUnanswered: number;
    /** 사무시간 한정. 야간/주말 미답변은 정상 → 조용 모드 발화 안 함. */
    officeOnly: true;
  };
  /** 같은 알림 키는 이 시간(분) 내 반복 발화 안 함. */
  cooldownMinutes: number;
}

export const UTTERANCE_THRESHOLDS: UtteranceThresholds = {
  ads: {
    actionableTypes: ["pause", "increase", "decrease", "duplicate", "creative_refresh"],
    urgentTypes: ["pause"], // 종료 = 예산 새는 것 멈춤 → 조용 모드에도 울림
  },
  sales: {
    noSaleHours: 3,
    officeOnly: true,
  },
  cs: {
    minUnanswered: 1, // 미답변 생기면 즉시
    officeOnly: true,
  },
  cooldownMinutes: 120, // 2시간
};

/**
 * 조용 모드에서 울려도 되는 '긴급' 신호인지.
 * 매출/CS는 officeOnly이므로 조용 모드에선 애초에 후보가 아니다.
 * 광고는 urgentTypes(=pause)만 긴급.
 */
export function isUrgent(
  signal: { type: UtteranceSignalType; adsActionType?: ActionType },
  t: UtteranceThresholds = UTTERANCE_THRESHOLDS,
): boolean {
  if (signal.type !== "ads") return false;
  return signal.adsActionType != null && t.ads.urgentTypes.includes(signal.adsActionType);
}

/**
 * 모드 + 신호로 발화 허용 여부(쿨다운 제외). Week 3 워커의 1차 게이트.
 *  - 사무실 모드: 모든 신호 허용
 *  - 조용 모드: 긴급(광고 pause)만 허용
 */
export function isSpeakableInMode(
  signal: { type: UtteranceSignalType; adsActionType?: ActionType },
  mode: MoriMode,
  t: UtteranceThresholds = UTTERANCE_THRESHOLDS,
): boolean {
  if (mode === "office") return true;
  return isUrgent(signal, t);
}
