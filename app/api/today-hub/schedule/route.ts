/**
 * /api/today-hub/schedule
 *   GET → 오늘(KST) 외부 약속 목록 (shong@harriotwatches.com 캘린더)
 */
import { listTodayEvents, TODAY_HUB_CALENDAR_ID } from "@/lib/today-hub/calendar";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await listTodayEvents();
    return Response.json({ ok: true, calendarId: TODAY_HUB_CALENDAR_ID, events });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
