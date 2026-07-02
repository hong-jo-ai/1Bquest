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

/**
 * Threads 장기토큰(60일) 자동 연장.
 * 마지막 저장(updated_at) 후 7일 지났으면 refresh_access_token 호출 → 새 토큰 저장(60일 리셋).
 * 이미 만료된 토큰은 연장 불가(재로그인 필요) — 2026-06 3개 브랜드 전부 만료됐던 사고 재발 방지용.
 * 실패해도 throw 안 함(호출측 크론 동작에 영향 X).
 */
export async function refreshThreadsTokenIfNeeded(brand: BrandId = "paulvice"): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { data } = await supabase
      .from("kv_store")
      .select("data,updated_at")
      .eq("key", kvKey(brand))
      .maybeSingle();
    const token = data?.data as string | undefined;
    if (!token) return;
    const ageMs = Date.now() - new Date((data as { updated_at?: string })?.updated_at ?? 0).getTime();
    if (ageMs < 7 * 24 * 3600 * 1000) return; // 갱신한 지 7일 미만 — 스킵

    const res = await fetch(
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`,
    );
    const j = (await res.json()) as { access_token?: string; error?: { message?: string } };
    if (j.access_token) {
      await saveThreadsToken(j.access_token, brand);
      console.log(`[Threads] ${brand} 토큰 자동연장 완료 (+60일)`);
    } else {
      console.error(`[Threads] ${brand} 토큰 연장 실패:`, j.error?.message ?? JSON.stringify(j).slice(0, 150));
    }
  } catch (e) {
    console.error(`[Threads] ${brand} 토큰 연장 오류:`, e instanceof Error ? e.message : e);
  }
}
