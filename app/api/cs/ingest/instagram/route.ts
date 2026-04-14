import { syncAllIgAccounts } from "@/lib/cs/instagramIngest";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function run() {
  try {
    const result = await syncAllIgAccounts();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  return run();
}

export async function POST() {
  return run();
}
