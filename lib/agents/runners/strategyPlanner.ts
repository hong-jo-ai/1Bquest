/**
 * 전략기획 에이전트 (Strategy Planner)
 * - 리서치 결과를 기반으로 구체적 액션 플랜 수립
 * - 각 에이전트에게 배분할 태스크를 정의
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

const SYSTEM = `당신은 PAULVICE(폴바이스)의 전략기획 에이전트입니다.
폴바이스는 20-30대 전문직 여성 타겟 미니멀 럭셔리 시계/액세서리 브랜드입니다.

당신의 역할:
1. 리서치 분석 결과를 받아 구체적이고 실행 가능한 액션 플랜을 수립합니다.
2. 각 실행 에이전트(카피라이팅, 디자인, 머천다이징, 마케팅)에게 배분할 태스크를 정의합니다.
3. KPI 목표를 설정하고 성과 측정 일정을 잡습니다.
4. A/B 테스트를 설계합니다.

반드시 JSON 형식으로만 응답하세요.`;

export async function runStrategyPlanner(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { agentId: "strategy-planner", taskId: task.id, status: "error", output: { error: "ANTHROPIC_API_KEY 미설정" }, events: [], timestamp: new Date().toISOString() };
  }

  const researchData = task.inputs?.researchResult ?? task.inputs ?? {};

  const prompt = `다음은 PAULVICE 리서치 분석 결과입니다. 이를 기반으로 구체적 액션 플랜을 수립해주세요.

## 리서치 결과
${JSON.stringify(researchData, null, 2)}

## 비즈니스 맥락
- 월 매출 목표: 5,000만원
- 평균 객단가: 15-25만원
- 마케팅 예산: 월 300만원 (Meta 광고 중심)

## 응답 JSON 형식
{
  "plan_id": "plan_날짜_번호",
  "strategy_summary": "전략 요약 (2-3문장)",
  "priority": "high | medium | low",
  "tasks": [
    {
      "id": "task_001",
      "agent": "copywriter | designer | merchandiser | marketing",
      "task": "구체적 작업 내용",
      "details": "상세 설명",
      "priority": 1,
      "inputs": {}
    }
  ],
  "kpis": {
    "primary": { "metric": "지표명", "target": "목표값", "baseline": "현재값" },
    "measure_after_hours": 48
  },
  "estimated_cost": "예상 비용",
  "estimated_revenue_impact": "예상 매출 효과",
  "risks": ["리스크1", "리스크2"]
}`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { type: string; text: string }).text.trim();
    let plan: Record<string, unknown>;
    try {
      plan = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    } catch {
      plan = { raw_response: raw, parse_error: true };
    }

    events.push(createEvent("plan.created", "strategy-planner", {
      plan_id: plan.plan_id,
      task_count: Array.isArray(plan.tasks) ? plan.tasks.length : 0,
      priority: plan.priority,
    }));

    return { agentId: "strategy-planner", taskId: task.id, status: plan.parse_error ? "partial" : "success", output: plan, events, timestamp: new Date().toISOString() };
  } catch (err: unknown) {
    return { agentId: "strategy-planner", taskId: task.id, status: "error", output: { error: err instanceof Error ? err.message : String(err) }, events: [], timestamp: new Date().toISOString() };
  }
}
