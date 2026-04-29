/**
 * Cron: 매일 KST 15:00 (UTC 06:00) 카카오선물하기 일일 발주서 자동 동기화.
 * vercel.json 에 schedule="0 6 * * *" 등록.
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

export async function GET() {
  try {
    const result = await syncKakaoGiftPos();
    const db = getDb();
    if (db) {
      await db.from("kv_store").upsert(
        {
          key: STATUS_KEY,
          data: {
            syncedAt:         new Date().toISOString(),
            triggeredBy:      "cron",
            processed:        result.processed,
            totalAttachments: result.totalAttachments,
            poDates:          result.poDates,
            errorCount:       result.errors.length,
            errors:           result.errors.slice(0, 5),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    }
    console.log("[cron:kakao-gift-po-sync]", JSON.stringify(result));
    return Response.json(result);
  } catch (e) {
    console.error("[cron:kakao-gift-po-sync] failed:", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
