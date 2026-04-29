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

/** 토큰에 실제 부여된 스코프 목록 — null = tokeninfo 자체가 실패 */
async function fetchTokenScopes(accessToken: string): Promise<string[] | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { scope?: string };
    return (json.scope ?? "").split(" ").filter(Boolean);
  } catch { return null; }
}

interface CalListResult {
  items: string[] | null;  // null = 호출 자체가 거부됨
  rawError?: string;
  status?: number;
}

/** 접근 가능한 캘린더 ID 목록 + 진단 정보 */
async function fetchCalendarList(accessToken: string): Promise<CalListResult> {
  try {
    const res = await fetch(`${CAL_BASE}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return { items: null, rawError: text, status: res.status };
    }
    const json = (await res.json()) as { items?: Array<{ id?: string }> };
    return { items: (json.items ?? []).map((c) => c.id ?? "").filter(Boolean) };
  } catch (e) {
    return { items: null, rawError: e instanceof Error ? e.message : String(e) };
  }
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
    const eventsBody = await res.text();
    if (res.status === 403 || res.status === 401) {
      // 자동 진단 — 어디서 막혔는지 사용자에게 알려줌
      const [userInfo, calList, scopes] = await Promise.all([
        fetchUserInfo(accessToken),
        fetchCalendarList(accessToken),
        fetchTokenScopes(accessToken),
      ]);
      const connectedEmail = userInfo?.email ?? "(알 수 없음)";
      const lines: string[] = [`캘린더 접근 실패 (HTTP ${res.status})`];
      lines.push(`연결된 Google 계정: ${connectedEmail}`);
      lines.push(`대상 캘린더: ${TODAY_HUB_CALENDAR_ID}`);

      const hasCalScope = (scopes ?? []).some((s) =>
        s.includes("calendar")
      );
      if (scopes) {
        lines.push(`부여된 스코프 ${scopes.length}개: ${scopes.map(s => s.replace("https://www.googleapis.com/auth/", "")).join(", ")}`);
      }
      lines.push("");

      // 케이스 1: calendar.readonly 자체가 토큰에 없음 → 동의 누락
      if (!hasCalScope) {
        lines.push("원인: calendar.readonly 가 토큰에 부여되지 않았습니다.");
        lines.push("→ 동의 화면에서 '캘린더 보기' 권한 체크 안 됐거나");
        lines.push("  Google Workspace(harriotwatches.com) 관리자가 차단했을 수 있습니다.");
        lines.push("→ '/api/auth/google/login' 으로 재시도. 동의 화면에 캘린더 항목이");
        lines.push("  안 보이면 admin.google.com 에서 앱 권한 검토 필요.");
      }
      // 케이스 2: 스코프는 있는데 calendarList API 가 막힘 → API 미활성화일 가능성 큼
      else if (calList.items === null) {
        lines.push("원인: calendar.readonly 스코프는 있지만 Calendar API 호출이 거부됨.");
        if (calList.rawError && /has not been used|disabled|enable/i.test(calList.rawError)) {
          lines.push("→ GCP 프로젝트에 Google Calendar API 가 활성화되지 않았습니다.");
          lines.push("  console.cloud.google.com → APIs & Services → Library →");
          lines.push("  'Google Calendar API' 검색 후 Enable 클릭.");
        } else {
          lines.push("→ Workspace 관리자 정책 또는 GCP API 활성화 문제 의심.");
        }
        if (calList.rawError) {
          lines.push("");
          lines.push(`Google 응답 (calendarList ${calList.status}):`);
          lines.push(calList.rawError.slice(0, 400));
        }
      }
      // 케이스 3: calendarList 는 되는데 대상 캘린더가 목록에 없음
      else if (!calList.items.some((id) => id === TODAY_HUB_CALENDAR_ID)) {
        lines.push(`원인: ${connectedEmail} 계정에 ${TODAY_HUB_CALENDAR_ID} 캘린더가 보이지 않습니다.`);
        lines.push("");
        lines.push("해결: shong@harriotwatches.com 으로 직접 OAuth 또는 그 캘린더를 공유.");
        if (calList.items.length > 0) {
          lines.push("");
          lines.push(`접근 가능한 캘린더 (${calList.items.length}개):`);
          for (const id of calList.items.slice(0, 5)) lines.push(`  • ${id}`);
        }
      }
      // 케이스 4: 보이는데 events 읽기만 거부
      else {
        lines.push("원인: 캘린더는 보이지만 events 읽기 권한 부족.");
        lines.push("→ Google 캘린더 공유 설정에서 '모든 일정 세부정보 보기' 이상 부여.");
        lines.push("");
        lines.push(`Google 응답 (events ${res.status}):`);
        lines.push(eventsBody.slice(0, 400));
      }
      throw new Error(lines.join("\n"));
    }
    throw new Error(`Calendar API ${res.status}: ${eventsBody}`);
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
