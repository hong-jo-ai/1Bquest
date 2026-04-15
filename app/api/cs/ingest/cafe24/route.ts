import { syncCafe24Boards } from "@/lib/cs/cafe24BoardIngest";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function run() {
  try {
    const result = await syncCafe24Boards();
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
