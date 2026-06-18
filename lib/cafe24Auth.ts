/**
 * 브라우저 요청 컨텍스트에서 유효한 Cafe24 access token 반환.
 *
 * v2 — Supabase 가 SSOT, 모든 lambda 가 같은 access_token 공유:
 *   1. cafe24TokenStore.getAccessTokenFromStore() 가 만료 체크 + 필요 시 refresh
 *   2. 쿠키는 사용 안 함 (refresh rotation race 의 주범)
 *   3. 콜백에서만 saveCafe24TokenFull 로 저장
 */
import { getAccessTokenFromStore, saveCafe24TokenFull } from "./cafe24TokenStore";
import { DEFAULT_MALL, type MallId, type TokenResponse } from "./cafe24Client";

export async function getValidC24Token(mall: MallId = DEFAULT_MALL): Promise<string | null> {
  return getAccessTokenFromStore(mall);
}

/** 콜백/수동 로그인 후 토큰 저장 — Supabase 에만 저장 (쿠키 의존 제거). */
export async function saveInitialCafe24Token(token: TokenResponse, mall: MallId = DEFAULT_MALL): Promise<void> {
  await saveCafe24TokenFull(token, mall);
}
