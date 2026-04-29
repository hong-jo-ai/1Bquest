/**
 * 오늘의 운영 허브 — 외부 약속 (구글 캘린더 읽기 전용).
 * 입력은 폰의 구글 캘린더 앱에서, 대시보드는 단순 표시.
 */
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

/** 외부 약속을 가져올 캘린더. OAuth 계정이 이 캘린더 접근 권한이 있어야 함. */
export const TODAY_HUB_CALENDAR_ID = "shong@harriotwatches.com";

export interface CalendarEvent {
  id:       string;
  /** "HH:MM" 또는 "종일" */
  time:     string;
  title:    string;
  location: string;
  /** ISO — 정렬용 */
  startAt:  string;
  htmlLink: string;
}

interface RawEvent {
  id:           string;
  status?:      string;
  summary?:     string;
  location?:    string;
  htmlLink?:    string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?:   { dateTime?: string; date?: string; timeZone?: string };
}

function kstDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function kstDayBoundsRfc3339(): { timeMin: string; timeMax: string } {
  const today = kstDateStr(0);
  return {
    timeMin: `${today}T00:00:00+09:00`,
    timeMax: `${today}T23:59:59+09:00`,
  };
}

/** ISO datetime → KST HH:MM */
function fmtKstHm(iso: string): string {
  const d = new Date(iso);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function listTodayEvents(): Promise<CalendarEvent[]> {
  const accessToken = await getGoogleAccessTokenFromStore();
  if (!accessToken) {
    throw new Error("Google 미연결 — /analytics 에서 Google 연결 필요");
  }

  const { timeMin, timeMax } = kstDayBoundsRfc3339();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy:      "startTime",
    maxResults:   "20",
  });

  const url = `${CAL_BASE}/calendars/${encodeURIComponent(TODAY_HUB_CALENDAR_ID)}/events?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403 || res.status === 401) {
      throw new Error(
        `캘린더 접근 권한 없음 (${res.status}) — Google 재연결 필요. ` +
        `calendar.readonly 스코프가 부여된 상태로 OAuth 재진행 후 ` +
        `${TODAY_HUB_CALENDAR_ID} 캘린더 접근 권한이 있는 계정으로 로그인하세요.`,
      );
    }
    throw new Error(`Calendar API ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { items?: RawEvent[] };

  return (json.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map((e): CalendarEvent => {
      const isAllDay = !!e.start?.date && !e.start?.dateTime;
      const startIso = e.start?.dateTime ?? `${e.start?.date}T00:00:00+09:00`;
      return {
        id:       e.id,
        time:     isAllDay ? "종일" : fmtKstHm(startIso),
        title:    e.summary?.trim() || "(제목 없음)",
        location: (e.location ?? "").trim(),
        startAt:  startIso,
        htmlLink: e.htmlLink ?? "",
      };
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}
