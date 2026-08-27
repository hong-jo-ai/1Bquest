/** KST 기준 날짜 계산. 서버가 UTC 라 로컬 타임존에 기대지 않는다. */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** YYYY-MM-DD (KST) */
export function kstDateStr(offsetDays = 0, base: Date = new Date()): string {
  const d = new Date(base.getTime() + KST_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** 오늘(KST)부터 대상 날짜까지 남은 일수. 음수 = 지났음 */
export function daysUntil(dateStr: string): number {
  const today  = new Date(`${kstDateStr()}T00:00:00Z`).getTime();
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.round((target - today) / 86_400_000);
}

/** ISO 시각 이후 며칠이 지났는지 (KST 날짜 기준). 오늘 만졌으면 0 */
export function staleDaysSince(iso: string): number {
  return Math.max(0, -daysUntil(kstDateStr(0, new Date(iso))));
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "8월 28일 · 금요일" */
export function todayLabel(): { date: string; weekday: string } {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  return {
    date:    `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`,
    weekday: `${WEEKDAYS[d.getUTCDay()]}요일`,
  };
}
