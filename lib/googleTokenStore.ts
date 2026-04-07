/**
 * Supabase kv_store를 통한 Google refresh token 영속화.
 * Cron 등 쿠키 없는 환경에서 Gmail API 호출 시 사용.
 */
import { createClient } from "@supabase/supabase-js";
import { refreshGoogleToken } from "./ga4Client";

const KV_KEY = "google_refresh_token";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function saveGoogleRefreshToken(refreshToken: string): Promise<void> {
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

export async function getGoogleAccessTokenFromStore(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", KV_KEY)
    .maybeSingle();
  if (!data?.data) return null;
  const refreshToken = data.data as string;
  return refreshGoogleToken(refreshToken);
}
