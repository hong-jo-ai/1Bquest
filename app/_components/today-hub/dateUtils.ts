/** KST 기준 YYYY-MM-DD (offset: 일수 가감) */
export function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** KST 기준 YYYY-MM */
export function kstMonthStr(): string {
  return kstDateStr(0).slice(0, 7);
}

/** KST 기준 가장 최근 일요일의 YYYY-MM-DD (주 단위 리셋용) */
export function kstWeekStartStr(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dow = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** 오늘부터 targetDate(YYYY-MM-DD)까지 일수. 음수면 지난 날짜. */
export function daysUntil(targetDate: string): number {
  const today = kstDateStr(0);
  const t = Date.UTC(
    parseInt(targetDate.slice(0, 4)),
    parseInt(targetDate.slice(5, 7)) - 1,
    parseInt(targetDate.slice(8, 10)),
  );
  const n = Date.UTC(
    parseInt(today.slice(0, 4)),
    parseInt(today.slice(5, 7)) - 1,
    parseInt(today.slice(8, 10)),
  );
  return Math.round((t - n) / 86400000);
}
