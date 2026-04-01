/**
 * 서버(Vercel KV) ↔ localStorage 양방향 동기화 유틸
 *
 * - saveToServer: localStorage에 쓴 뒤 서버에도 반영 (fire-and-forget)
 * - loadFromServer: 서버에서 최신 데이터를 받아 localStorage 갱신
 */

const STORE_API = "/api/store";

/** localStorage에 저장 + 서버 백그라운드 동기화 */
export function saveWithSync(key: string, data: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(data));
  // 서버로 fire-and-forget
  fetch(STORE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, data }),
  }).catch(() => {}); // 실패해도 localStorage는 유지됨
}

/**
 * 서버에서 최신 데이터 로드 → localStorage 갱신 → 반환
 * KV 미설정이면 null 반환 (localStorage 사용 유지)
 */
export async function loadFromServer<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${STORE_API}?key=${encodeURIComponent(key)}`, {
      cache: "no-store",
    });
    const { data, reason } = await res.json();
    if (reason === "KV_NOT_CONFIGURED" || data === null) return null;
    // 서버 데이터가 있으면 localStorage 갱신
    if (typeof window !== "undefined") {
      localStorage.setItem(key, JSON.stringify(data));
    }
    return data as T;
  } catch {
    return null;
  }
}
