/**
 * 상품개발 에이전트 (Product Dev)
 * - 시장 갭 분석, 신상품 아이디어, 소싱 키워드
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

const SYSTEM = `당신은 PAULVICE(폴바이스)의 상품개발 에이전트입니다.

## 현재 라인업
- 오토매틱 시계 (15-30만원)
- 쿼츠 시계 (10-20만원)
- 스트랩/밴드 (3-5만원)
- 액세서리 (파우치, 케이스, 각인)

## 포지셔닝
- "합리적 럭셔리" 여성 시계
- 한국 디자인 + 수입 무브먼트
- 미니멀 디자인, 오피스룩/데일리룩

매출/재고 데이터를 분석하여 상품 라인업의 갭을 찾고, 신상품 아이디어를 제안합니다.
반드시 JSON 형식으로만 응답하세요.`;

export async function runProductDev(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { agentId: "product-dev", taskId: task.id, status: "error", output: { error: "ANTHROPIC_API_KEY 미설정" }, events: [], timestamp: new Date().toISOString() };
  }

  const inputs = task.inputs ?? {};

  const prompt = `PAULVICE 상품개발 리포트를 작성해주세요.

## 현재 데이터
${JSON.stringify(inputs, null, 2)}

## 응답 JSON 형식
{
  "report_date": "${new Date().toISOString().split("T")[0]}",
  "gap_analysis": {
    "price_gaps": [{ "range": "가격대", "current_products": 0, "demand_signal": "high|medium|low", "note": "설명" }],
    "style_gaps": [{ "style": "스타일명", "current_products": 0, "demand_signal": "high|medium|low" }],
    "material_gaps": [{ "material": "소재", "current_products": 0, "demand_signal": "high|medium|low" }]
  },
  "new_product_ideas": [
    {
      "name": "제품명",
      "category": "카테고리",
      "target_price": "가격",
      "target_audience": "타겟",
      "concept": "컨셉 설명",
      "rationale": ["근거1", "근거2"],
      "estimated_margin": "마진율",
      "priority": "high|medium|low",
      "specs": { "movement": "", "case_size": "", "case_material": "", "strap": "", "water_resistance": "" }
    }
  ],
  "sourcing_keywords": {
    "alibaba_cn": ["중문 키워드"],
    "alibaba_en": ["영문 키워드"]
  },
  "summary": "요약 (2-3문장)"
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
    let report: Record<string, unknown>;
    try {
      report = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    } catch {
      report = { raw_response: raw, parse_error: true };
    }

    events.push(createEvent("productdev.report.ready", "product-dev", {
      idea_count: Array.isArray(report.new_product_ideas) ? (report.new_product_ideas as unknown[]).length : 0,
    }));

    return { agentId: "product-dev", taskId: task.id, status: report.parse_error ? "partial" : "success", output: report, events, timestamp: new Date().toISOString() };
  } catch (err: unknown) {
    return { agentId: "product-dev", taskId: task.id, status: "error", output: { error: err instanceof Error ? err.message : String(err) }, events: [], timestamp: new Date().toISOString() };
  }
}
