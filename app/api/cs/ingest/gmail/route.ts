import { syncAllGmailAccounts } from "@/lib/cs/gmailIngest";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function run() {
  try {
    const result = await syncAllGmailAccounts();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

// GET: Vercel Cron 호출용 — CRON_SECRET 검증
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

// POST: UI 수동 트리거용 — 인증 없이 허용 (앱 내부에서만 호출)
export async function POST() {
  return run();
}
