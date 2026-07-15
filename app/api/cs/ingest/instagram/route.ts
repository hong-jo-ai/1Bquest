import { syncAllIgAccounts } from "@/lib/cs/instagramIngest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function run(opts: { sinceDays?: number; maxPages?: number } = {}) {
  try {
    const result = await syncAllIgAccounts(opts);
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
  // 크론(매시): 최근 활동 대화만 처리해 빠르게(메시지 조회는 반환된 대화에만 발생).
  return run({ sinceDays: 14, maxPages: 3 });
}

// 수동 POST: 전체 백필(윈도우 제한 없음).
export async function POST() {
  return run({ maxPages: 3 });
}
