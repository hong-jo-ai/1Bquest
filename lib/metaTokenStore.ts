/**
 * Supabase kv_store를 통한 Meta access token 영속화.
 * Meta는 장기 토큰(60일)이므로 refresh 없이 저장/조회만.
 */
import { createClient } from "@supabase/supabase-js";

const KV_KEY = "meta_access_token";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function saveMetaToken(accessToken: string): Promise<void> {
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

export async function getMetaTokenFromStore(): Promise<string | null> {
  // 1순위: 환경변수 (개발자 콘솔에서 발급한 토큰)
  if (process.env.META_SYSTEM_TOKEN) return process.env.META_SYSTEM_TOKEN;

  // 2순위: Supabase에 저장된 OAuth 토큰
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
