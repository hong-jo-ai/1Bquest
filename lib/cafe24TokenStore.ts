/**
 * Cafe24 refresh token 영속 저장소 (Supabase kv_store 기반).
 *
 * 설계 원칙: Supabase가 refresh token의 단일 진실 공급원(SSOT).
 *   - 모든 refresh 결과는 즉시 Supabase에 저장
 *   - 쿠키는 빠른 access를 위한 캐시 역할만
 *   - 두 저장소 간 race로 토큰이 서로 무효화되는 문제 방지
 *
 * 동시 refresh 방지: 모듈 레벨 inflight Promise로 같은 인스턴스 내
 * 중복 refresh 합침 (refresh token rotation 시 race로 둘 다 죽는 것 방지).
 */
import { createClient } from "@supabase/supabase-js";
import { doRefresh, type TokenResponse } from "./cafe24Client";

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

/** Supabase에서 현재 저장된 refresh token 읽기 (refresh 안 함) */
export async function readRefreshTokenFromStore(): Promise<string | null> {
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

// ── 동시 refresh 방지 (in-flight dedup) ───────────────────────────────
let inflightRefresh: Promise<TokenResponse> | null = null;

/**
 * refresh token으로 access token 획득.
 * - 같은 인스턴스 내 동시 호출은 1회로 합쳐짐
 * - 결과는 자동으로 Supabase에 영속화됨
 * - 호출자가 받은 TokenResponse는 추가로 쿠키 등에 반영 가능
 */
export async function refreshCafe24Token(refreshToken: string): Promise<TokenResponse> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    const tokenResponse = await doRefresh(refreshToken);
    // 항상 즉시 SSOT 갱신 — 다음 호출이 새 토큰 사용
    await saveCafe24Token(tokenResponse.refresh_token);
    return tokenResponse;
  })().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

/** Supabase의 refresh token으로 access token 획득 (cron 등 쿠키 없는 환경용) */
export async function getAccessTokenFromStore(): Promise<string | null> {
  const refreshToken = await readRefreshTokenFromStore();
  if (!refreshToken) return null;
  try {
    const tokenResponse = await refreshCafe24Token(refreshToken);
    return tokenResponse.access_token;
  } catch (e) {
    console.error("[Cafe24] Supabase 경로 refresh 실패:", e);
    return null;
  }
}
