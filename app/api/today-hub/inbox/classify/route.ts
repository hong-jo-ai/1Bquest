/**
 * POST /api/today-hub/inbox/classify
 *   인박스 14일치 → AI 분류 즉시 실행 (수동 트리거).
 */
import { syncInbox } from "@/lib/today-hub/inboxClassifier";
import { saveStatus } from "@/lib/today-hub/inboxStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const status = await syncInbox();
    await saveStatus(status);
    return Response.json({ ok: true, status });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
