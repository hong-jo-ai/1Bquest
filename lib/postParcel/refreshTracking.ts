/**
 * 우체국 종추적 일괄 갱신 (화면 버튼 · 크론 공용).
 *
 * ⚠️ 원래 /shipping 화면의 "배송조회" 버튼에서만 돌아서, 아무도 누르지 않으면
 *    pp_shipments.tracking_state 가 영영 비어 있었다(2026-08-05 확인: 최근 출고 25건
 *    전부 tracking_checked_at = null). 우체국 API 는 정상이었고 호출자가 없던 것.
 *    → 같은 로직을 크론(/api/cron/parcel-track)에서도 돌리려고 여기로 뺐다.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { trackOne } from "./tracking";

export interface RefreshTrackingOptions {
  /** 지정 시 해당 건만 갱신(배달완료도 재조회). 미지정이면 미배달 건 자동 선별. */
  ids?: string[];
  /** 한 회차 최대 조회 건수. 400ms 스로틀이 붙으므로 실행시간 예산에 맞춰 잡는다. */
  limit?: number;
  /** 접수일이 이 일수보다 오래된 건은 제외(자동 선별일 때만). 오래된 소포를 영원히 조회하지 않기 위함. */
  maxAgeDays?: number;
}

export interface RefreshTrackingResult {
  checked: number;
  updated: number;
  delivered: number;
  results: Array<{ id: string; rgist: string; state?: string; found: boolean; error?: string }>;
}

function sb(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function refreshShipmentTracking(
  options: RefreshTrackingOptions = {}
): Promise<RefreshTrackingResult> {
  const { ids, limit = 200, maxAgeDays = 30 } = options;
  const specified = Array.isArray(ids) && ids.length > 0;
  const client = sb();

  let q = client
    .from("pp_shipments")
    .select("id, regi_no, tracking_state, status, tracking_checked_at")
    .not("regi_no", "is", null)
    .neq("regi_no", "TESTREGINOAPI");

  if (specified) {
    q = q.in("id", ids!);
  } else {
    const since = new Date(Date.now() - maxAgeDays * 24 * 3600_000).toISOString();
    q = q
      .neq("status", "cancelled")
      .or(`registered_at.gte.${since},registered_at.is.null`)
      // 오래 확인 안 된 건부터 — 한 회차에 다 못 돌아도 다음 회차에서 돌아가며 채워진다.
      .order("tracking_checked_at", { ascending: true, nullsFirst: true })
      .limit(1000);
  }

  const { data: rows, error } = await q;
  if (error) throw new Error(`pp_shipments 조회 실패: ${error.message}`);

  // 자동 선별일 땐 이미 배달완료인 건은 재조회 불필요.
  const targets = (rows ?? [])
    .filter((t) => specified || !(t.tracking_state && t.tracking_state.includes("배달완료")))
    .slice(0, limit);

  const results: RefreshTrackingResult["results"] = [];
  for (const t of targets) {
    const tr = await trackOne(t.regi_no);
    // 결과없음(ERR-001, 갓 접수해 이벤트 없음)·일시 에러일 땐 기존 상태를 보존한다
    // — 예전 정상 상태를 빈 값으로 덮어쓰지 않도록. checked_at 은 항상 기록.
    const patch: Record<string, unknown> = {
      tracking_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (tr.found && tr.state) {
      patch.tracking_state = tr.state;
      patch.tracking_detail = tr.scans?.length ? tr.scans : null;
    }
    await client.from("pp_shipments").update(patch).eq("id", t.id);
    results.push({ id: t.id, rgist: t.regi_no, state: tr.state, found: tr.found, error: tr.error });
    // 우체국 OpenAPI 연속 호출 throttle 회피 (같은 초에 몰리면 빈 응답)
    await sleep(400);
  }

  return {
    checked: results.length,
    updated: results.filter((r) => r.found && r.state).length,
    delivered: results.filter((r) => r.state?.includes("배달완료")).length,
    results,
  };
}
