/**
 * 우체국 배송추적 자동 갱신.
 *
 * 배경(2026-08-05): 종추적 갱신이 /shipping 화면의 "배송조회" 버튼에만 걸려 있어,
 *   아무도 안 누르면 pp_shipments.tracking_state 가 계속 비어 있었다.
 *   실측 — 8/3 이후 출고 25건 전부 tracking_checked_at = null.
 *   우체국 OpenAPI 는 정상이었고(실제 등기 2건 조회 성공) 호출자가 없던 것.
 *   배송완료 여부는 리뷰요청 알림톡·CS 문의 응대의 기준이라 비어 있으면 안 된다.
 *
 * 하루 3회(KST 09/14/21시). 오래 확인 안 된 건부터 돌아가며 갱신하고,
 * 배달완료된 건과 접수 30일 초과 건은 대상에서 빠진다.
 */
import { withCron } from "@/lib/cron/withCron";
import { refreshShipmentTracking } from "@/lib/postParcel/refreshTracking";

export const dynamic = "force-dynamic";
// 400ms 스로틀 × 250건 + API 응답시간 → 여유 있게 300s.
export const maxDuration = 300;

async function run(): Promise<Response> {
  if (!process.env.POSTPARCEL_TRACK_KEY) {
    throw new Error("POSTPARCEL_TRACK_KEY env 누락 — 종추적 조회 불가");
  }
  const { checked, updated, delivered } = await refreshShipmentTracking({ limit: 250 });
  return Response.json({ ok: true, checked, updated, delivered });
}

export const GET = withCron("parcel-track", run);
