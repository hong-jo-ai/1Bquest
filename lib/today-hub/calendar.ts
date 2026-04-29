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

async function fetchUserInfo(accessToken: string): Promise<{ email: string } | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as { email: string };
  } catch { return null; }
}

/** 접근 가능한 캘린더 ID 목록. null = calendar.readonly 권한 자체가 없음. */
async function fetchCalendarList(accessToken: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${CAL_BASE}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { items?: Array<{ id?: string }> };
    return (json.items ?? []).map((c) => c.id ?? "").filter(Boolean);
  } catch { return null; }
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
    if (res.status === 403 || res.status === 401) {
      // 자동 진단 — 어디서 막혔는지 사용자에게 알려줌
      const [userInfo, calList] = await Promise.all([
        fetchUserInfo(accessToken),
        fetchCalendarList(accessToken),
      ]);
      const connectedEmail = userInfo?.email ?? "(알 수 없음)";
      const lines: string[] = [`캘린더 접근 실패 (HTTP ${res.status})`];
      lines.push(`연결된 Google 계정: ${connectedEmail}`);
      lines.push(`대상 캘린더: ${TODAY_HUB_CALENDAR_ID}`);
      lines.push("");

      if (calList === null) {
        lines.push("원인: calendar.readonly 권한이 부여되지 않았습니다.");
        lines.push("→ '/api/auth/google/login' 으로 재연결 시 동의 화면에서");
        lines.push("  '캘린더 보기' 권한을 반드시 체크하세요.");
      } else if (!calList.some((id) => id === TODAY_HUB_CALENDAR_ID)) {
        lines.push(`원인: ${connectedEmail} 계정에 ${TODAY_HUB_CALENDAR_ID} 캘린더가 보이지 않습니다.`);
        lines.push("");
        lines.push("해결 방법 (둘 중 하나):");
        lines.push(`  (A) shong@harriotwatches.com 으로 직접 OAuth — 가장 간단`);
        lines.push(`  (B) shong@harriotwatches.com 캘린더를 ${connectedEmail} 에 공유`);
        lines.push("      (Google 캘린더 → 해당 캘린더 설정 → 특정 사용자와 공유)");
        if (calList.length > 0) {
          lines.push("");
          lines.push(`참고 — 현재 접근 가능한 캘린더 (${calList.length}개):`);
          for (const id of calList.slice(0, 5)) lines.push(`  • ${id}`);
        }
      } else {
        lines.push("원인: 캘린더는 보이지만 이벤트 읽기 권한이 부족합니다.");
        lines.push("→ 캘린더 공유 설정에서 '모든 일정 세부정보 보기' 이상 부여 필요.");
      }
      throw new Error(lines.join("\n"));
    }
    const text = await res.text();
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
