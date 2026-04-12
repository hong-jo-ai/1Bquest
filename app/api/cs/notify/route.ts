import { notifyNewUnanswered, notifyStaleUnanswered } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "new";

  try {
    const result =
      mode === "stale" ? await notifyStaleUnanswered() : await notifyNewUnanswered();
    return Response.json({ ok: true, mode, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
