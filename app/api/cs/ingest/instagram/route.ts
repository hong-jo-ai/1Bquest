/**
 * 인스타 인제스트 크론 (매시 :10) — DM + 댓글.
 *
 * ⚠️ 2026-09-01 관제 편입. 그전까지 이 크론만 `withCron` 밖에 있어 하트비트가 없었다.
 *    2026-05 토큰이 무효화됐을 때 **두 달간 아무 알림 없이** 유입이 0이었던 이유가 이것이다.
 *    인증도 fail-open 이었다(CRON_SECRET 없으면 통과).
 */
import { getCsSupabase } from "@/lib/cs/store";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { syncAllIgAccounts } from "@/lib/cs/instagramIngest";
import { syncAllIgComments } from "@/lib/cs/instagramComments";
import { manualRun, withCron } from "@/lib/cron/withCron";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** 갱신이 도는데도 만료가 다가오면 = 갱신이 조용히 실패하는 중. 토큰이 죽기 전에 알린다. */
const TOKEN_WARN_DAYS = 7;

async function warnIfTokenExpiring() {
  try {
    const db = getCsSupabase();
    const { data } = await db
      .from("cs_accounts")
      .select("id,brand,display_name,credentials")
      .eq("channel", "ig_dm")
      .eq("status", "active");
    for (const acc of data ?? []) {
      const creds = (acc.credentials ?? {}) as { ig_login_expires_at?: number };
      const exp = Number(creds.ig_login_expires_at ?? 0);
      if (!exp) continue;
      const daysLeft = (exp - Date.now()) / 86_400_000;
      if (daysLeft > TOKEN_WARN_DAYS) continue;
      // 매시 크론이라 24시간 억제 — 안 그러면 하루 24통이 온다.
      const dedupKey = `ig_token_alerted:${acc.id}`;
      const { data: seen } = await db.from("kv_store").select("data").eq("key", dedupKey).maybeSingle();
      const last = (seen?.data as { at?: string } | null)?.at;
      if (last && Date.now() - new Date(last).getTime() < 24 * 3600_000) continue;
      await db.from("kv_store").upsert(
        { key: dedupKey, data: { at: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      await sendTelegramMessage(
        `🔑 <b>인스타 토큰 만료 임박</b> — ${acc.display_name ?? acc.brand}\n` +
          `${Math.floor(daysLeft)}일 남음 (만료 ${new Date(exp).toISOString().slice(0, 10)}).\n` +
          `자동갱신은 10일 전부터 매시 시도하는데 아직 안 밀렸다 = <b>갱신이 실패하고 있다</b>.\n` +
          `메타 개발자 앱에서 IGAA 토큰 재발급이 필요할 수 있습니다.`,
      );
    }
  } catch {
    /* 경보 실패가 인제스트를 막으면 안 된다 */
  }
}

async function run(opts: { sinceDays?: number; maxPages?: number } = {}) {
  // DM 과 댓글은 서로 독립 — 한쪽이 죽어도 다른 쪽은 받아야 한다.
  const [dm, comments] = await Promise.allSettled([
    syncAllIgAccounts(opts),
    syncAllIgComments(opts),
  ]);
  await warnIfTokenExpiring();

  const dmOk = dm.status === "fulfilled";
  const cmOk = comments.status === "fulfilled";
  const body = {
    ok: dmOk || cmOk,
    dm: dmOk ? dm.value : { error: String(dm.reason).slice(0, 300) },
    comments: cmOk ? comments.value : { error: String(comments.reason).slice(0, 300) },
  };
  // 둘 다 터졌을 때만 5xx → withCron 이 알림을 쏜다. 한쪽만 죽으면 본문에 남기고 계속 돈다.
  return Response.json(body, { status: dmOk || cmOk ? 200 : 500 });
}

// 크론(매시): 최근 활동 대화만 처리해 빠르게(메시지 조회는 반환된 대화에만 발생).
export const GET = withCron("cs-ingest-instagram", () => run({ sinceDays: 14, maxPages: 3 }));

// 수동 POST: 전체 백필(윈도우 제한 없음).
export async function POST() {
  return manualRun("cs-ingest-instagram", () => run({ maxPages: 3 }));
}
