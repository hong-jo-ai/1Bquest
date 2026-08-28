import { syncAllThreadsBrands } from "@/lib/cs/threadsIngest";
import { refreshThreadsTokenIfNeeded } from "@/lib/threadsTokenStore";
import type { BrandId } from "@/lib/threadsBrands";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const THREADS_BRANDS: BrandId[] = ["paulvice", "harriot", "hongsungjo"];

/**
 * Threads 장기토큰 자동연장(내부에서 7일 주기로만 실제 갱신).
 * 원래 threads-autopost 크론이 하던 일인데, 게시를 중단하며 그 크론을 내려서
 * 여기로 옮겼다(2026-08-28). 안 하면 60일 뒤 토큰이 만료돼 재로그인해야 하고,
 * 그러면 DM 수집(이 라우트)까지 같이 멈춘다.
 * ⚠️ 연장 실패가 DM 수집을 막으면 안 된다 → 브랜드별로 삼킨다.
 */
async function refreshTokens(): Promise<void> {
  for (const brand of THREADS_BRANDS) {
    try {
      await refreshThreadsTokenIfNeeded(brand);
    } catch (e) {
      console.warn(`[cs-ingest-threads] ${brand} 토큰 연장 실패:`, e instanceof Error ? e.message : String(e));
    }
  }
}

async function run() {
  try {
    await refreshTokens();
    const result = await syncAllThreadsBrands();
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
