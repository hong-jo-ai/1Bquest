/**
 * GET /api/today/activity → 클로드 코드 세션에서 뽑은 "진행 중인 일"
 *
 * 적재는 local-agent/claudeActivityScan.js 가 한다. 여기서는 읽기만.
 */
import { getActivity } from "@/lib/today/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getActivity();
  return Response.json({ ok: !result.error, ...result });
}
