import { runEvaluationCycle } from "@/lib/mads/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const result = await runEvaluationCycle();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
