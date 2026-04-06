/**
 * 리서치 에이전트 (Research Analyst)
 * - 수집 데이터를 Claude로 분석
 * - 저조 상품, 트렌드, 인사이트 도출
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

const SYSTEM = `당신은 PAULVICE(폴바이스)의 전문 데이터 분석가입니다.
폴바이스는 20-30대 전문직 여성을 타겟으로 한 미니멀 럭셔리 시계/액세서리 브랜드입니다.
Cafe24 자사몰 기반이며, 가격대는 10만~30만원입니다.

당신의 역할:
1. 매출/재고/트래픽 데이터를 분석하여 문제점과 기회를 발견합니다.
2. 저조 상품의 원인을 구체적으로 진단합니다.
3. 재고 에이징이 심각한 상품에 대한 소진 전략을 제안합니다.
4. 데이터에 기반한 실행 가능한 인사이트를 제공합니다.

반드시 JSON 형식으로만 응답하세요.`;

export async function runResearchAnalyst(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      agentId: "research-analyst",
      taskId: task.id,
      status: "error",
      output: { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다" },
      events: [],
      timestamp: new Date().toISOString(),
    };
  }

  // 입력 데이터 가져오기 (data-collector 결과 또는 직접 전달)
  const snapshot = task.inputs?.snapshot ?? task.inputs ?? {};

  const prompt = `다음은 PAULVICE 온라인 스토어의 최신 데이터입니다. 분석해주세요.

## 수집 데이터
${JSON.stringify(snapshot, null, 2)}

## 분석 요청
다음 JSON 형식으로 분석 결과를 작성해주세요:

{
  "summary": "전반적인 상황 요약 (2-3문장)",
  "health_score": 1~10 (전체 건강도 점수),
  "underperformers": [
    {
      "sku": "상품 SKU",
      "name": "상품명",
      "issue": "문제 설명",
      "severity": "high | medium | low",
      "causes": ["원인1", "원인2"],
      "recommended_actions": [
        { "type": "pricing | content | marketing | merchandising", "detail": "구체적 액션" }
      ]
    }
  ],
  "aging_alerts": [
    {
      "sku": "SKU",
      "name": "상품명",
      "days_in_stock": 숫자,
      "current_stock": 숫자,
      "aging_status": "urgent | critical",
      "clearance_suggestion": "소진 전략 제안"
    }
  ],
  "opportunities": [
    { "title": "기회 제목", "detail": "설명", "estimated_impact": "예상 효과" }
  ],
  "action_items": [
    { "priority": 1, "action": "액션 설명", "agent": "담당 에이전트", "deadline": "시기" }
  ]
}

데이터가 부족하거나 없는 항목은 빈 배열로 처리하세요.
반드시 유효한 JSON만 응답하세요.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { type: string; text: string }).text.trim();
    let analysis: Record<string, unknown>;
    try {
      analysis = raw.startsWith("{")
        ? JSON.parse(raw)
        : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    } catch {
      analysis = { raw_response: raw, parse_error: true };
    }

    // 이벤트 발행
    events.push(createEvent("research.complete", "research-analyst", {
      health_score: analysis.health_score,
      underperformer_count: Array.isArray(analysis.underperformers) ? analysis.underperformers.length : 0,
      aging_alert_count: Array.isArray(analysis.aging_alerts) ? analysis.aging_alerts.length : 0,
    }));

    // 저조 상품 발견 시
    const underperformers = analysis.underperformers as { severity?: string }[] | undefined;
    if (underperformers?.some((u) => u.severity === "high")) {
      events.push(createEvent("product.underperforming", "research-analyst", {
        products: underperformers.filter((u) => u.severity === "high"),
      }));
    }

    return {
      agentId: "research-analyst",
      taskId: task.id,
      status: analysis.parse_error ? "partial" : "success",
      output: analysis,
      events,
      timestamp: new Date().toISOString(),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      agentId: "research-analyst",
      taskId: task.id,
      status: "error",
      output: { error: message },
      events: [],
      timestamp: new Date().toISOString(),
    };
  }
}
