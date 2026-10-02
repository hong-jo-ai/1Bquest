import { watchCafe24Claims } from "@/lib/cafe24ClaimWatch";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run() {
  try {
    const result = await watchCafe24Claims();
    return Response.json({ ok: result.errors.length === 0, ...result }, { status: result.errors.length ? 500 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export const GET = withCron("cafe24-claim-watch", () => run());
