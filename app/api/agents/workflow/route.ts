/**
 * POST /api/agents/workflow
 * 워크플로우 실행
 * Body: { workflowId }
 */
import { type NextRequest } from "next/server";
import { executeWorkflow, WORKFLOWS, registerRunner } from "@/lib/agents/orchestrator";
import { runDataCollector } from "@/lib/agents/runners/dataCollector";
import { runResearchAnalyst } from "@/lib/agents/runners/researchAnalyst";
import { runStrategyPlanner } from "@/lib/agents/runners/strategyPlanner";
import { runCopywriter } from "@/lib/agents/runners/copywriter";
import { runDesigner } from "@/lib/agents/runners/designer";
import { runMarketing } from "@/lib/agents/runners/marketing";
import { runMerchandiser } from "@/lib/agents/runners/merchandiser";
import { runProductDev } from "@/lib/agents/runners/productDev";
import { runPromptEngineer } from "@/lib/agents/runners/promptEngineer";

// 에이전트 러너 등록 (9개)
registerRunner("data-collector", runDataCollector);
registerRunner("research-analyst", runResearchAnalyst);
registerRunner("strategy-planner", runStrategyPlanner);
registerRunner("copywriter", runCopywriter);
registerRunner("designer", runDesigner);
registerRunner("marketing", runMarketing);
registerRunner("merchandiser", runMerchandiser);
registerRunner("product-dev", runProductDev);
registerRunner("prompt-engineer", runPromptEngineer);

export async function POST(req: NextRequest) {
  try {
    const { workflowId } = await req.json();

    if (!workflowId) {
      return Response.json({ error: "workflowId is required" }, { status: 400 });
    }

    const workflow = WORKFLOWS.find((w) => w.id === workflowId);
    if (!workflow) {
      return Response.json({ error: `Unknown workflow: ${workflowId}` }, { status: 400 });
    }

    const run = await executeWorkflow(workflow);

    return Response.json({
      ok: true,
      run,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
