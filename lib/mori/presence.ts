/**
 * 모리 화면 접속 감지(presence).
 *
 * /mori 페이지가 살아 있으면 클라이언트 폴(120s)이 touchPresence()로 도장을 찍는다.
 * cron(자리비움 경로)은 isAway()로 "지금 화면을 안 보고 있다"를 판정해, 그럴 때만
 * 능동 발화를 텔레그램으로 밀어준다. 화면 앞이면 화면이 알아서 띄우므로 푸쉬 안 함.
 */

import { createClient } from "@supabase/supabase-js";

const KEY = "mori:presence";
/** 마지막 접속이 이보다 오래됐으면 자리비움으로 본다(클라 폴 120s의 ~2.5배 여유). */
const AWAY_MS = 5 * 60 * 1000;

function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** /mori 화면이 살아 있음을 기록(클라 폴마다). */
export async function touchPresence(): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    await d
      .from("kv_store")
      .upsert(
        { key: KEY, data: { lastSeenAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
  } catch {
    /* noop */
  }
}

/** 지금 화면을 안 보고 있는가(= 텔레그램으로 밀어야 하는가). */
export async function isAway(): Promise<boolean> {
  const d = db();
  if (!d) return true; // 알 수 없으면 푸쉬가 안전(놓치는 것보단 낫다)
  try {
    const { data } = await d.from("kv_store").select("data").eq("key", KEY).maybeSingle();
    const lastSeenAt = (data?.data as { lastSeenAt?: string } | null)?.lastSeenAt;
    if (!lastSeenAt) return true;
    return Date.now() - new Date(lastSeenAt).getTime() > AWAY_MS;
  } catch {
    return true;
  }
}
