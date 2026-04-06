/**
 * Supabase kv_store를 통한 Cafe24 refresh token 영속화.
 * Cron 등 쿠키가 없는 서버 환경에서 토큰을 가져올 때 사용.
 */
import { createClient } from "@supabase/supabase-js";
import { doRefresh } from "./cafe24Client";

const KV_KEY = "cafe24_refresh_token";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** refresh token을 Supabase에 저장 */
export async function saveCafe24Token(refreshToken: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase
    .from("kv_store")
    .upsert(
      { key: KV_KEY, data: refreshToken, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw error;
}

/** Supabase에서 refresh token → access token 획득 (+ 새 refresh token 갱신 저장) */
export async function getAccessTokenFromStore(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", KV_KEY)
    .maybeSingle();

  if (error || !data?.data) return null;

  const refreshToken = data.data as string;
  const tokenResponse = await doRefresh(refreshToken);

  // 새 refresh token 저장 (카페24는 갱신 시 새 refresh token 발급)
  await saveCafe24Token(tokenResponse.refresh_token);

  return tokenResponse.access_token;
}
