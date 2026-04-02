/**
 * Cafe24 액세스 토큰을 안전하게 가져오는 헬퍼.
 * - c24_at 쿠키가 있으면 바로 반환
 * - 없으면(만료) c24_rt로 갱신 후 쿠키 업데이트 & 반환
 * - 둘 다 없으면 null 반환
 */
import { cookies } from "next/headers";
import { doRefresh } from "./cafe24Client";

export async function getValidC24Token(): Promise<string | null> {
  const cookieStore = await cookies();
  const at = cookieStore.get("c24_at")?.value;
  if (at) return at;

  const rt = cookieStore.get("c24_rt")?.value;
  if (!rt) return null;

  try {
    const newToken = await doRefresh(rt);
    cookieStore.set("c24_at", newToken.access_token, {
      httpOnly:  true,
      secure:    true,
      maxAge:    newToken.expires_in ?? 7200,
      path:      "/",
      sameSite:  "lax",
    });
    cookieStore.set("c24_rt", newToken.refresh_token, {
      httpOnly:  true,
      secure:    true,
      maxAge:    60 * 60 * 24 * 14,
      path:      "/",
      sameSite:  "lax",
    });
    return newToken.access_token;
  } catch (e) {
    console.error("[Cafe24] token refresh failed:", e);
    return null;
  }
}
