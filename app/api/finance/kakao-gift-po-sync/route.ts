/**
 * /api/finance/kakao-gift-po-sync
 *   POST → 즉시 동기화 (대시보드 수동 트리거 / cron 둘 다 사용)
 *   GET  → 최근 동기화 상태 (마지막 동기화 시간, 최근 N일 PO 요약)
 */
import { syncKakaoGiftPos } from "@/lib/finance/kakaoGiftPoSync";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_KEY = "kakao_gift_po:last_sync";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function POST() {
  try {
    const result = await syncKakaoGiftPos();
    const db = getDb();
    if (db) {
      await db.from("kv_store").upsert(
        {
          key: STATUS_KEY,
          data: {
            syncedAt: new Date().toISOString(),
            processed: result.processed,
            totalAttachments: result.totalAttachments,
            poDates: result.poDates,
            errorCount: result.errors.length,
            errors: result.errors.slice(0, 5),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    }
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  const db = getDb();
  if (!db) return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });

  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", STATUS_KEY)
    .maybeSingle();

  return Response.json({ ok: true, status: data?.data ?? null });
}
