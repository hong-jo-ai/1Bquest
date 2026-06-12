/**
 * 서버(Supabase KV) ↔ localStorage 양방향 동기화 유틸
 *
 * - saveWithSync: localStorage에 쓰고 서버에 반영 + "미확정(pending)" 표시. 서버 확정되면 표시 해제.
 * - loadFromServer: 서버 최신을 받아 localStorage 갱신. 단 **미확정 로컬 저장이 있으면 덮어쓰지 않고
 *   재전송만** 한다 (fire-and-forget POST가 서버 반영되기 전에 새로고침/폴링 로드가 로컬 변경을
 *   날려버리는 경합 방지 — 숨기기/재고입력이 새로고침하면 사라지던 버그 수정).
 */

const STORE_API = "/api/store";
const PENDING_PREFIX = "__sync_pending:"; // 미확정 저장 표시 (localStorage, 새로고침에도 유지)

function postToServer(key: string, data: unknown, stamp: string): void {
  fetch(STORE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, data }),
  })
    .then(async (res) => {
      // 세션 만료 시 /login(200 HTML)로 리다이렉트되므로 res.ok만으론 부족 → 본문 {ok:true} 확인.
      let saved = false;
      try { saved = res.ok && (await res.json())?.ok === true; } catch { saved = false; }
      // 이 저장 이후 더 새로운 저장이 없을 때만 미확정 해제 (덮어쓰기 안전)
      if (saved && typeof window !== "undefined" && localStorage.getItem(PENDING_PREFIX + key) === stamp) {
        localStorage.removeItem(PENDING_PREFIX + key);
      }
    })
    .catch(() => {}); // 실패 시 미확정 유지 → 다음 로드에서 재전송
}

/** localStorage에 저장 + 서버 동기화(미확정 표시). 서버 확정 전까지 로드가 덮어쓰지 않음. */
export function saveWithSync(key: string, data: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(data));
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(PENDING_PREFIX + key, stamp);
  postToServer(key, data, stamp);
}

/**
 * 서버에서 최신 데이터 로드 → localStorage 갱신 → 반환.
 * 미확정 로컬 저장이 있으면: 서버로 덮어쓰지 않고 로컬을 유지하며 재전송(확정 시도)한다.
 * KV 미설정/서버 데이터 없으면 null.
 */
export async function loadFromServer<T>(key: string): Promise<T | null> {
  // 미확정 로컬 저장 보호 — 서버로 덮어쓰지 않고 재전송
  if (typeof window !== "undefined") {
    const stamp = localStorage.getItem(PENDING_PREFIX + key);
    if (stamp) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as T;
          postToServer(key, parsed, stamp); // 확정 재시도
          return parsed;
        } catch {
          return null;
        }
      }
    }
  }
  try {
    const res = await fetch(`${STORE_API}?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const { data, reason } = await res.json();
    if (reason === "KV_NOT_CONFIGURED" || data === null) return null;
    if (typeof window !== "undefined") {
      localStorage.setItem(key, JSON.stringify(data));
    }
    return data as T;
  } catch {
    return null;
  }
}
