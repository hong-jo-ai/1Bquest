/**
 * CARE 매출 귀속 크론 — 등록자가 그 뒤 자사몰에서 샀는지 매일 갱신한다.
 *
 * 등록 수는 실시간으로 알 수 있지만 "그래서 팔렸나"는 주문이 들어온 뒤에야 안다.
 * 아침에 대시보드를 열었을 때 전날까지의 전환이 반영돼 있도록 KST 06:00 에 돈다.
 */
import { withCron } from "@/lib/cron/withCron";
import { run } from "@/app/api/crm/care/attribute/route";

export const maxDuration = 300;

async function cronMain() {
  const r = await run();
  if (!r.ok) throw new Error(r.error);      // 실패는 삼키지 않는다 — withCron 이 알림을 띄운다
  return Response.json(r);
}

export const GET = withCron("care-attribute", cronMain);
