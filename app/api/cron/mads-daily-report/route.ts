import { buildAndSendDailyReport } from "@/lib/mads/dailyReport";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
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
