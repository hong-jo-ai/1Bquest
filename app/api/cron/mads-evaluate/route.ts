import { runEvaluationCycle } from "@/lib/mads/orchestrator";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function cronMain() {
  const result = await runEvaluationCycle();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = withCron("mads-evaluate", () => cronMain());

// 대시보드 "재평가" 버튼용 수동 트리거 (기존 GET 공개호출 → POST 이전)
export async function POST() {
  return cronMain();
}
