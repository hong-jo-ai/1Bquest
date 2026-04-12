import { syncAllGmailAccounts } from "@/lib/cs/gmailIngest";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST /api/cs/ingest/gmail
 * Cron 또는 수동 호출. 모든 등록된 Gmail 계정의 최근 INBOX를 수집한다.
 * 보호: CRON_SECRET 헤더 검증.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await syncAllGmailAccounts();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  // Vercel Cron은 기본적으로 GET으로 호출됨
  return POST(req);
}
