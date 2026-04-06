/**
 * 프롬프팅 에이전트 (Prompt Engineer)
 * - 프롬프트 관리, 품질 평가, A/B 테스트
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

const SYSTEM = `당신은 PAULVICE(폴바이스) 에이전트 팀의 프롬프팅 에이전트입니다.
다른 에이전트의 출력 품질을 평가하고, 프롬프트를 최적화합니다.

## 평가 기준 (텍스트)
- 브랜드 일관성 (25%): PAULVICE 톤 앤 매너
- 타겟 적합성 (20%): 20-30대 전문직 여성
- 설득력 (20%): 구매 전환 기여도
- 독창성 (15%): 진부하지 않은 표현
- SEO 최적화 (10%)
- 길이 적절성 (10%)

## 평가 기준 (이미지 프롬프트)
- 브랜드 비주얼 (30%): 컬러/무드/스타일
- 상품 매력도 (25%): 시계가 매력적으로 보이는지
- 구도/레이아웃 (20%)
- 기술 품질 (15%)
- 플랫폼 적합성 (10%)

반드시 JSON 형식으로만 응답하세요.`;

export async function runPromptEngineer(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { agentId: "prompt-engineer", taskId: task.id, status: "error", output: { error: "ANTHROPIC_API_KEY 미설정" }, events: [], timestamp: new Date().toISOString() };
  }

  const inputs = task.inputs ?? {};
  const contentToEvaluate = inputs.content ?? inputs;

  const prompt = `다음 에이전트 출력의 품질을 평가해주세요.

## 평가 대상
${JSON.stringify(contentToEvaluate, null, 2)}

## 응답 JSON 형식
{
  "evaluation": {
    "agent": "평가 대상 에이전트",
    "overall_score": 8.5,
    "scores": {
      "brand_consistency": 9,
      "target_fit": 8,
      "persuasion": 8,
      "originality": 9,
      "seo_or_technical": 7,
      "appropriateness": 10
    },
    "strengths": ["강점1", "강점2"],
    "weaknesses": ["약점1"],
    "improvement_suggestions": ["개선안1", "개선안2"],
    "prompt_optimization_tips": ["프롬프트 개선 팁"]
  },
  "prompt_registry_update": {
    "recommended": false,
    "reason": "현재 프롬프트로 충분 | 개선 필요",
    "suggested_changes": []
  },
  "cost_estimate": {
    "input_tokens": 0,
    "output_tokens": 0,
    "estimated_cost_usd": 0
  }
}`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { type: string; text: string }).text.trim();
    let result: Record<string, unknown>;
    try {
      result = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    } catch {
      result = { raw_response: raw, parse_error: true };
    }

    events.push(createEvent("prompt.evaluation.complete", "prompt-engineer", {
      overall_score: (result.evaluation as Record<string, unknown>)?.overall_score ?? null,
    }));

    return { agentId: "prompt-engineer", taskId: task.id, status: result.parse_error ? "partial" : "success", output: result, events, timestamp: new Date().toISOString() };
  } catch (err: unknown) {
    return { agentId: "prompt-engineer", taskId: task.id, status: "error", output: { error: err instanceof Error ? err.message : String(err) }, events: [], timestamp: new Date().toISOString() };
  }
}
