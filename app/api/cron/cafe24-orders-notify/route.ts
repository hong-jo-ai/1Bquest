import { notifyNewCafe24Orders } from "@/lib/cafe24OrdersNotify";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run() {
  try {
    const result = await notifyNewCafe24Orders();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = withCron("cafe24-orders-notify", () => run());

export async function POST() {
  return run();
}
