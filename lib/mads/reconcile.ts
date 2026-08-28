/**
 * 사장님이 **메타 광고관리자에서 직접 조치한 것**을 MADS 추천에 반영한다.
 *
 * 왜 필요한가 (2026-08-28, 사장님 지적 — 반복되던 불만):
 * "끄라고 해서 메타 들어가서 껐는데 경고가 계속 온다."
 *
 * 원인: 추천이 pending 을 벗어나는 길이 셋뿐이었다 —
 *   ① 같은 광고세트에 새 추천이 생겨 superseded  ② 36시간 만료  ③ 대시보드/텔레그램 버튼.
 * 그런데 메타에서 끄는 순간 그 세트는 `effective_status=ACTIVE` 필터에서 빠져 **새 추천이 안 생기고**,
 * 따라서 ①이 영영 실행되지 않는다. 버튼도 안 눌렀으니 ③도 없다. 결국 36시간 내내 pending 으로 남고,
 * mori-pulse 가 2시간마다 그걸 다시 읽어 텔레그램을 쏜다(≈18회, 매번 다른 LLM 문구라 중복으로 보이지도 않음).
 *
 * 그래서 "이미 처리된 추천"을 실제 상태로 판정해 닫는 경로를 따로 만든다.
 * 이 함수만 알림 직전에 부르면 모든 소비자(pulse·브리핑·확인카드)가 한 번에 조용해진다.
 */
import { listRecommendations, setRecommendationStatus, updateAdSetStatus } from "./dbStore";
import { metaGet } from "../metaClient";
// ⚠️ getMetaTokenServer 가 아니라 store 쪽을 쓴다 — 이 함수는 크론·pulse 에서 불리는데
//    getMetaTokenServer 는 cookies() 를 먼저 보므로 요청 컨텍스트 밖에서 위험하다.
import { getMetaTokenFromStore } from "../metaTokenStore";

/** 메타에서 살아있다고 볼 상태. 이 외(PAUSED/ARCHIVED/DELETED…)면 조치가 끝난 것으로 본다. */
const LIVE = "ACTIVE";

export type ReconcileResult = {
  checked: number;
  closed: number;
  closedNames: string[];
  error?: string;
};

/**
 * pending 추천 중 대상 광고세트가 더 이상 ACTIVE 가 아닌 것을 superseded 로 닫는다.
 *
 * 판정 순서:
 *   1) DB(mads_ad_sets.status)가 이미 비ACTIVE → 그것만으로 닫는다(메타 호출 없음).
 *   2) DB 는 ACTIVE 인데 메타에서 방금 껐을 수 있다 → **메타에 실시간 확인**.
 *      DB 상태는 하루 한 번(mads-evaluate)만 갱신돼서, 끈 직후~다음 평가까지 최대 24시간이 비는데
 *      하필 그 구간이 알림이 가장 시끄러운 구간이다.
 *
 * ⚠️ 실패해도 던지지 않는다 — 이 정리가 안 됐다고 알림 자체가 멈추면 안 된다.
 */
export async function reconcilePendingRecommendations(): Promise<ReconcileResult> {
  const out: ReconcileResult = { checked: 0, closed: 0, closedNames: [] };
  try {
    const pending = await listRecommendations("pending", 100);
    // 'hold' 는 조치를 요구하지 않으므로 정리 대상이 아니다.
    const actionable = pending.filter((r) => r.actionType !== "hold");
    out.checked = actionable.length;
    if (!actionable.length) return out;

    const closeIds: Array<{ id: string; name: string; how: string }> = [];
    const needsLiveCheck: typeof actionable = [];

    for (const r of actionable) {
      if (r.adset?.status && r.adset.status !== LIVE) {
        closeIds.push({ id: r.id, name: r.adset?.name ?? r.metaAdsetId, how: `db:${r.adset.status}` });
      } else {
        needsLiveCheck.push(r);
      }
    }

    // 메타 실시간 확인 — 광고세트 id 로 배치 조회(보통 0~3건이라 호출 비용은 무시할 만하다).
    if (needsLiveCheck.length) {
      const statuses = await fetchLiveStatuses(needsLiveCheck.map((r) => r.metaAdsetId));
      for (const r of needsLiveCheck) {
        const live = statuses.get(r.metaAdsetId);
        if (live && live !== LIVE) {
          closeIds.push({ id: r.id, name: r.adset?.name ?? r.metaAdsetId, how: `meta:${live}` });
          await syncAdSetStatus(r.metaAdsetId, live);
        }
      }
    }

    for (const c of closeIds) {
      try {
        await setRecommendationStatus(c.id, "superseded", { reconciled: c.how });
        out.closed++;
        out.closedNames.push(c.name);
      } catch (e) {
        console.warn("[mads-reconcile] 추천 닫기 실패:", e instanceof Error ? e.message : String(e));
      }
    }
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    console.warn("[mads-reconcile] 실패(무시):", out.error);
    return out;
  }
}

/** 광고세트 id → effective_status. 조회 실패한 id 는 맵에서 빠진다(=판단 보류, 알림 유지). */
async function fetchLiveStatuses(adsetIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(adsetIds)].filter(Boolean);
  if (!ids.length) return map;
  try {
    const token = await getMetaTokenFromStore();
    if (!token) return map;
    // ?ids=a,b,c 배치 조회 — 건별 호출보다 싸다.
    const res = (await metaGet("/", token, {
      ids: ids.join(","),
      fields: "id,status,effective_status",
    })) as Record<string, { status?: string; effective_status?: string }>;
    for (const [id, v] of Object.entries(res ?? {})) {
      const s = v?.effective_status ?? v?.status;
      if (typeof s === "string") map.set(id, s);
    }
  } catch (e) {
    // 토큰 만료·일시 장애 — 상태를 모르면 닫지 않는다(조치 안 한 건을 조용히 삼키는 쪽이 더 위험).
    console.warn("[mads-reconcile] 메타 상태 조회 실패:", e instanceof Error ? e.message : String(e));
  }
  return map;
}

/** 메타에서 확인한 상태를 DB 에도 반영 — 다음 사이클까지 같은 판정을 반복하지 않게. */
async function syncAdSetStatus(metaAdsetId: string, status: string): Promise<void> {
  try {
    await updateAdSetStatus(metaAdsetId, status);
  } catch (e) {
    console.warn("[mads-reconcile] 상태 동기화 실패:", e instanceof Error ? e.message : String(e));
  }
}
