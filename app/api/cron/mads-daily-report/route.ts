import { buildAndSendDailyReport } from "@/lib/mads/dailyReport";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function cronMain() {
  try {
    const result = await buildAndSendDailyReport();
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const GET = withCron("mads-daily-report", () => cronMain());
