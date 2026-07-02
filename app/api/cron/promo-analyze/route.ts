/**
 * Cron: 채널 프로모션 제안 메일 자동 분석.
 * plvekorea@ 받은편지함을 스캔해 프로모션 제안을 분석하고 shong@ 로 제안 메일 + 텔레그램 발송.
 * vercel.json: 평일 09:10 KST(00:10 UTC), 14:00 KST(05:00 UTC).
 */
import { scanAndAnalyzePromoEmails } from "@/lib/promo/analyze";
import { createClient } from "@supabase/supabase-js";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const STATUS_KEY = "promo_analyze:last_run";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function cronMain() {
  try {
    const result = await scanAndAnalyzePromoEmails();
    const db = getDb();
    if (db) {
      await db.from("kv_store").upsert(
        {
          key: STATUS_KEY,
          data: { ranAt: new Date().toISOString(), ...result },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
    }
    console.log("[cron:promo-analyze]", JSON.stringify(result));
    return Response.json(result);
  } catch (e) {
    console.error("[cron:promo-analyze] failed:", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const GET = withCron("promo-analyze", () => cronMain());
