/**
 * Cafe24 토큰 영속 저장소 (Supabase kv_store) — 멀티몰.
 *
 * v2 설계 — Vercel serverless rotation race 방지:
 *   - access_token + refresh_token + expires_at 을 통째로 Supabase 단일 row 에 저장
 *   - 모든 lambda 인스턴스가 같은 access_token 공유 → 만료 전엔 refresh 호출 X
 *   - refresh 실패 시 Supabase 다시 읽어서 다른 lambda 가 이미 refresh 한 결과 활용 (재시도)
 *
 * 멀티몰: 몰별 kv 키(paulvice=cafe24_refresh_token, harriot=cafe24_refresh_token:harriot).
 * 모든 함수는 mall 인자 생략 시 기본 paulvice(완전 후방호환).
 * 레거시 호환: 기존엔 refresh_token 만 string 으로 저장. 첫 마이그레이션 시 자동 보정.
 */
import { createClient } from "@supabase/supabase-js";
import { doRefresh, tokenKeyForMall, DEFAULT_MALL, type MallId, type TokenResponse } from "./cafe24Client";

const TOKEN_BUFFER_SEC = 90; // 만료 임박 버퍼 (90초 전부터는 refresh)

interface CachedToken {
  access_token:  string;
  refresh_token: string;
  /** epoch ms — 이 시간 이후엔 만료된 것으로 간주 */
  expires_at:    number;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function tokenFromResponse(t: TokenResponse): CachedToken {
  const ttl = (t.expires_in ?? 7200) - TOKEN_BUFFER_SEC;
  return {
    access_token:  t.access_token,
    refresh_token: t.refresh_token,
    expires_at:    Date.now() + ttl * 1000,
  };
}

async function readRaw(mall: MallId): Promise<unknown> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", tokenKeyForMall(mall))
    .maybeSingle();
  if (error) return null;
  return data?.data ?? null;
}

async function readToken(mall: MallId): Promise<CachedToken | null> {
  const raw = await readRaw(mall);
  if (!raw) return null;
  // 레거시: 그냥 string (refresh_token 단일)
  if (typeof raw === "string") {
    return {
      access_token:  "",       // 비어있음 — 즉시 refresh 강제
      refresh_token: raw,
      expires_at:    0,
    };
  }
  // v2: 객체
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Partial<CachedToken>;
    if (o.refresh_token && typeof o.expires_at === "number") {
      return {
        access_token:  o.access_token ?? "",
        refresh_token: o.refresh_token,
        expires_at:    o.expires_at,
      };
    }
  }
  return null;
}

async function writeToken(t: CachedToken, mall: MallId): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from("kv_store").upsert(
    { key: tokenKeyForMall(mall), data: t, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

/** 외부 호환 — 콜백에서 saveCafe24Token(refreshToken) 으로만 호출됨. 새 refresh + 즉시 refresh 1회로 풀 토큰 채움. */
export async function saveCafe24Token(refreshToken: string, mall: MallId = DEFAULT_MALL): Promise<void> {
  // 콜백 직후엔 access_token 도 같이 받았지만 호출자 시그니처가 string 만 받음.
  // 즉시 refresh 한 번 돌려서 풀 객체 만들어 저장 (cafe24 의 refresh 는 access+refresh 같이 새로 줌).
  try {
    const tr = await doRefresh(refreshToken, mall);
    await writeToken(tokenFromResponse(tr), mall);
  } catch (e) {
    console.error("[Cafe24] saveCafe24Token: 즉시 refresh 실패 (refresh_token 만 raw 저장):", e);
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from("kv_store").upsert(
        { key: tokenKeyForMall(mall), data: refreshToken, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    }
  }
}

/** 콜백에서 access + refresh 둘 다 받은 직후 — 즉시 풀 객체 저장 (refresh 한 번 더 돌리지 않음). */
export async function saveCafe24TokenFull(t: TokenResponse, mall: MallId = DEFAULT_MALL): Promise<void> {
  await writeToken(tokenFromResponse(t), mall);
}

export async function readRefreshTokenFromStore(mall: MallId = DEFAULT_MALL): Promise<string | null> {
  const t = await readToken(mall);
  return t?.refresh_token ?? null;
}

// ── 동시 refresh 방지 (in-flight dedup, 단일 lambda 안에서만 · 몰별) ─────────
const inflightRefresh: Partial<Record<MallId, Promise<CachedToken>>> = {};

/** Supabase + Cafe24 호출로 토큰 갱신, race 시 재시도. */
async function refreshAndSave(currentRt: string, mall: MallId): Promise<CachedToken> {
  const existing = inflightRefresh[mall];
  if (existing) return existing;
  const p = (async () => {
    try {
      const tr = await doRefresh(currentRt, mall);
      const cached = tokenFromResponse(tr);
      await writeToken(cached, mall);
      return cached;
    } catch (e) {
      // race: 다른 lambda 가 이미 refresh 해서 currentRt 가 무효일 수 있음
      // → Supabase 에서 한 번 더 읽어 살아있는 access_token 이 있으면 그걸 사용
      const fresh = await readToken(mall);
      if (fresh && fresh.access_token && Date.now() < fresh.expires_at) {
        return fresh;
      }
      throw e;
    }
  })().finally(() => { inflightRefresh[mall] = undefined; });
  inflightRefresh[mall] = p;
  return p;
}

/**
 * 유효한 access_token 반환.
 * - Supabase 에 살아있는 access_token 있으면 그대로 반환 (refresh 호출 X)
 * - 만료/없음 → refresh + 저장
 */
export async function getAccessTokenFromStore(mall: MallId = DEFAULT_MALL): Promise<string | null> {
  const t = await readToken(mall);
  if (!t) return null;

  if (t.access_token && Date.now() < t.expires_at) {
    return t.access_token;
  }

  if (!t.refresh_token) return null;

  try {
    const fresh = await refreshAndSave(t.refresh_token, mall);
    return fresh.access_token;
  } catch (e) {
    console.error("[Cafe24] refresh 실패:", e);
    return null;
  }
}

/** 외부 호환 — refresh 직접 호출 (race 안전 버전). */
export async function refreshCafe24Token(refreshToken: string, mall: MallId = DEFAULT_MALL): Promise<TokenResponse> {
  const cached = await refreshAndSave(refreshToken, mall);
  const mallId = (mall === "harriot" ? process.env.HARRIOT_CAFE24_MALL_ID : process.env.CAFE24_MALL_ID) ?? "";
  return {
    access_token:  cached.access_token,
    refresh_token: cached.refresh_token,
    expires_in:    Math.max(60, Math.floor((cached.expires_at - Date.now()) / 1000)),
    token_type:    "Bearer",
    scope:         "",
    mall_id:       mallId,
    shop_no:       1,
  };
}
