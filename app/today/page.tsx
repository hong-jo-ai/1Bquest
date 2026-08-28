/**
 * /today — 아침 업무 보드.
 *
 * 기존 대시보드 홈(/)이 매출 중심이라면 이 화면은 "오늘 뭐부터 하지"에 답하는 화면이다.
 * 캘린더에 적힌 것만 보지 않고, 클로드 코드 세션 기록에서 실제로 진행 중인 일을 끌어온다.
 */
import type { Metadata, Viewport } from "next";
import AppHeader from "@/components/AppHeader";
import { listCalendarEvents } from "@/lib/today-hub/calendar";
import { getActivity } from "@/lib/today/activity";
import { getKakaoItems } from "@/lib/today/kakao";
import { kstDateStr, todayLabel } from "@/lib/today/date";
import type { CalendarEvent } from "@/lib/today-hub/calendar";
import TodayBoard from "./TodayBoard";

export const dynamic = "force-dynamic";

/**
 * 홈화면에 추가했을 때 대시보드와 구분되도록 아이콘·매니페스트를 따로 준다.
 * 페이지 metadata 는 레이아웃 것을 필드 단위로 덮어쓴다.
 */
export const metadata: Metadata = {
  title:    "오늘 · 하루 한 장",
  manifest: "/manifest-today.webmanifest",
  appleWebApp: {
    capable:        true,
    title:          "TODAY",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon:  "/app-icon-today-512.png",
    apple: "/app-icon-today-180.png",
  },
};

export const viewport: Viewport = { themeColor: "#0d4a42" };

export default async function TodayPage() {
  // 캘린더가 막혀도 보드 자체는 떠야 한다 — 할일·활동은 캘린더와 무관하다.
  let events: CalendarEvent[] = [];
  let calendarError: string | null = null;
  try {
    events = await listCalendarEvents({ period: "next_7d", maxResults: 50 });
  } catch (e) {
    calendarError = e instanceof Error ? e.message : String(e);
  }

  const [activity, kakao] = await Promise.all([getActivity(), getKakaoItems()]);

  return (
    <>
      <AppHeader refreshHref="/today" />
      <TodayBoard
        today={kstDateStr()}
        label={todayLabel()}
        events={events}
        calendarError={calendarError}
        threads={activity.threads}
        scannedAt={activity.scannedAt}
        closedCount={activity.closedCount}
        activityError={activity.error ?? null}
        kakaoItems={kakao.items}
        kakaoAt={kakao.generatedAt}
      />
    </>
  );
}
