import { syncAllIgAccounts } from "@/lib/cs/instagramIngest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/cs/ingest/instagram/backfill?days=30
 * 지정된 일수만큼 IG DM을 과거로 거슬러 올라가며 수집.
 * 1회성 용도 (기본 sync는 최근만 가져옴).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const days = Math.min(
    Number(url.searchParams.get("days") ?? "30") || 30,
    90
  );
  const maxPages = Math.min(
    Number(url.searchParams.get("pages") ?? "8") || 8,
    20
  );

  try {
    const result = await syncAllIgAccounts({ sinceDays: days, maxPages });
    return Response.json({ ok: true, days, maxPages, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
