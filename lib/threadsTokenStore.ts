/**
 * Supabase kv_store를 통한 Threads access token 영속화.
 * 브랜드별로 별도 토큰 관리.
 */
import { createClient } from "@supabase/supabase-js";
import type { BrandId } from "./threadsBrands";

function kvKey(brand: BrandId = "paulvice") {
  return brand === "paulvice"
    ? "threads_access_token"
    : `threads_access_token_${brand}`;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function saveThreadsToken(accessToken: string, brand: BrandId = "paulvice"): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase
    .from("kv_store")
    .upsert(
      { key: kvKey(brand), data: accessToken, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) throw error;
}

export async function getThreadsTokenFromStore(brand: BrandId = "paulvice"): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", kvKey(brand))
    .maybeSingle();

  if (error || !data?.data) return null;
  return data.data as string;
}
