/**
 * Supabase kv_store를 통한 Threads access token 영속화.
 * OAuth 콜백에서 저장, publish API에서 조회.
 */
import { createClient } from "@supabase/supabase-js";

const KV_KEY = "threads_access_token";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function saveThreadsToken(accessToken: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase
    .from("kv_store")
    .upsert(
      { key: KV_KEY, data: accessToken, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw error;
}

export async function getThreadsTokenFromStore(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", KV_KEY)
    .maybeSingle();

  if (error || !data?.data) return null;
  return data.data as string;
}
