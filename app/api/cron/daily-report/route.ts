import { buildAndSendDailyReport } from "@/lib/dailyReport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await buildAndSendDailyReport();
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[daily-report] 실패:", msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
