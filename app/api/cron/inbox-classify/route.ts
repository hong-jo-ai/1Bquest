/**
 * Cron: 1시간마다 답장 필요 인박스 자동 분류.
 * vercel.json 에 schedule="0 * * * *" 등록.
 */
import { syncInbox } from "@/lib/today-hub/inboxClassifier";
import { saveStatus } from "@/lib/today-hub/inboxStore";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function cronMain() {
  try {
    const status = await syncInbox();
    await saveStatus(status);
    console.log("[cron:inbox-classify]", JSON.stringify(status));
    return Response.json({ ok: true, status });
  } catch (e) {
    console.error("[cron:inbox-classify] failed:", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const GET = withCron("inbox-classify", () => cronMain());
