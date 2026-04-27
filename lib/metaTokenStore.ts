/**
 * Supabase kv_store를 통한 Meta access token 영속화.
 * Meta는 장기 토큰(60일)이므로 refresh 없이 저장/조회만.
 */
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

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

export async function deleteMetaToken(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("kv_store").delete().eq("key", KV_KEY);
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

/**
 * 서버 컴포넌트/라우트에서 Meta 토큰을 통합 조회.
 * 1) 현재 브라우저의 `meta_at` 쿠키 (fast path)
 * 2) 없으면 env var 또는 Supabase kv_store (다른 기기에서 OAuth 한 경우)
 *
 * 단일 사용자 앱이므로 store fallback이 곧 "기기 간 동기화" 역할을 한다.
 */
export async function getMetaTokenServer(): Promise<string | null> {
  const cookieToken = (await cookies()).get("meta_at")?.value;
  if (cookieToken) return cookieToken;
  return getMetaTokenFromStore();
}
