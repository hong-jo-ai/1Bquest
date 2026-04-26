/**
 * 브라우저 요청 컨텍스트에서 유효한 Cafe24 access token을 가져온다.
 *
 * 흐름:
 *   1. c24_at 쿠키가 있으면 즉시 반환 (캐시 hit)
 *   2. 만료된 경우 Supabase의 refresh token으로 갱신
 *      (쿠키의 refresh token은 stale일 수 있어 SSOT인 Supabase 우선,
 *       Supabase가 비어있으면 쿠키 fallback — 최초 로그인 후 일관성 위해)
 *   3. 갱신 결과를 양쪽(Supabase + 쿠키)에 모두 저장 → 다음 호출들이 같은 최신 토큰 사용
 *   4. 모든 refresh는 cafe24TokenStore.refreshCafe24Token을 통과 → in-flight dedup 적용
 */
import { cookies } from "next/headers";
import {
  refreshCafe24Token,
  readRefreshTokenFromStore,
  saveCafe24Token,
} from "./cafe24TokenStore";

const ACCESS_TOKEN_TTL_DEFAULT = 7200;
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 14;

export async function getValidC24Token(): Promise<string | null> {
  const cookieStore = await cookies();
  const at = cookieStore.get("c24_at")?.value;
  if (at) return at;

  // SSOT 우선, 쿠키 fallback (최초 로그인 직후 Supabase가 비어있을 수 있음)
  const supabaseRt = await readRefreshTokenFromStore();
  const cookieRt = cookieStore.get("c24_rt")?.value;
  const rt = supabaseRt ?? cookieRt;
  if (!rt) return null;

  try {
    const newToken = await refreshCafe24Token(rt);

    // 쿠키도 즉시 동기화 (다음 요청에서 빠른 access)
    cookieStore.set("c24_at", newToken.access_token, {
      httpOnly: true,
      secure: true,
      maxAge: newToken.expires_in ?? ACCESS_TOKEN_TTL_DEFAULT,
      path: "/",
      sameSite: "lax",
    });
    cookieStore.set("c24_rt", newToken.refresh_token, {
      httpOnly: true,
      secure: true,
      maxAge: REFRESH_TOKEN_TTL,
      path: "/",
      sameSite: "lax",
    });

    return newToken.access_token;
  } catch (e) {
    console.error("[Cafe24] token refresh 최종 실패:", e);
    // 토큰이 죽었으니 쿠키도 정리 (배너가 '재연결 필요'로 표시되도록)
    try {
      cookieStore.delete("c24_at");
      cookieStore.delete("c24_rt");
    } catch { /* RSC 컨텍스트에서 delete 불가일 수 있음 */ }
    return null;
  }
}

/**
 * 콜백/수동 로그인 후 토큰 저장 — 양쪽(쿠키 + SSOT) 동시 저장.
 * app/api/auth/callback에서 사용.
 */
export async function saveInitialCafe24Token(token: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("c24_at", token.access_token, {
    httpOnly: true,
    secure: true,
    maxAge: token.expires_in ?? ACCESS_TOKEN_TTL_DEFAULT,
    path: "/",
    sameSite: "lax",
  });
  cookieStore.set("c24_rt", token.refresh_token, {
    httpOnly: true,
    secure: true,
    maxAge: REFRESH_TOKEN_TTL,
    path: "/",
    sameSite: "lax",
  });
  await saveCafe24Token(token.refresh_token);
}
