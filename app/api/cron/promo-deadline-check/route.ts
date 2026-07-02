/**
 * Cron: 프로모션 마감 알람.
 * promo-analyze 가 "참여/조건부 참여" 로 판단하고 미래 마감을 잡은 제안을 kv `promo_reminders` 에
 * 쌓아두면, 이 크론이 자주 돌며 남은 시간이 임계값(24h·3h)을 통과할 때 텔레그램 알람을 1회씩 보낸다.
 * vercel.json: 매시 45분(평일 한정 X — 마감은 주말에 닥칠 수도 있으므로 매일).
 */
import { checkPromoDeadlines } from "@/lib/promo/analyze";
import { createClient } from "@supabase/supabase-js";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS_KEY = "promo_deadline_check:last_run";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function cronMain() {
  try {
    const result = await checkPromoDeadlines();
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
    console.log("[cron:promo-deadline-check]", JSON.stringify(result));
    return Response.json(result);
  } catch (e) {
    console.error("[cron:promo-deadline-check] failed:", e);
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const GET = withCron("promo-deadline-check", () => cronMain());
