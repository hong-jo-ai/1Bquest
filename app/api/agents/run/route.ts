/**
 * POST /api/agents/run
 * 특정 에이전트를 실행하고 결과를 반환
 * Body: { agentId, task?, inputs? }
 */
import { type NextRequest } from "next/server";
import type { AgentId } from "@/lib/agents/types";
import { createTask, executeTask, registerRunner } from "@/lib/agents/orchestrator";
import { getAgent } from "@/lib/agents/registry";
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
    const { agentId, task: taskDesc, inputs } = await req.json();

    if (!agentId) {
      return Response.json({ error: "agentId is required" }, { status: 400 });
    }

    const config = getAgent(agentId as AgentId);
    if (!config) {
      return Response.json({ error: `Unknown agent: ${agentId}` }, { status: 400 });
    }

    const task = createTask(
      agentId as AgentId,
      taskDesc || `${config.name} 에이전트 실행`,
      inputs
    );

    const result = await executeTask(task);

    return Response.json({
      ok: true,
      task,
      result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
