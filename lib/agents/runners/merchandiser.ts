/**
 * 머천다이징 에이전트 (Merchandiser)
 * - 카테고리 진열, 가격 전략, 번들 구성, 재고 소진
 * - /inventory 페이지의 재고 데이터 활용
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

const SYSTEM = `당신은 PAULVICE(폴바이스)의 머천다이징 에이전트입니다.
온라인 스토어의 상품 진열, 가격 전략, 번들 구성을 최적화하여 매출을 극대화합니다.

## 할인 정책
- 에이징 caution (60일+): 15%
- 에이징 urgent (90일+): 25%
- 에이징 critical (180일+): 30-40%
- 30% 이상 할인은 사람 승인 필요 표시

## 진열 우선순위
1. 현재 프로모션 상품
2. 7일 매출 상위
3. 신상품 (14일 이내)
4. 에이징 urgent/critical (소진 필요)

반드시 JSON 형식으로만 응답하세요.`;

export async function runMerchandiser(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { agentId: "merchandiser", taskId: task.id, status: "error", output: { error: "ANTHROPIC_API_KEY 미설정" }, events: [], timestamp: new Date().toISOString() };
  }

  const inputs = task.inputs ?? {};

  // 재고 데이터 가져오기
  let inventoryData = inputs.inventory ?? null;
  if (!inventoryData) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
      const res = await fetch(`${baseUrl}/api/store?key=paulvice_inventory_v1`, { cache: "no-store" });
      const { data } = await res.json();
      inventoryData = data;
    } catch { /* 재고 데이터 없이 진행 */ }
  }

  const prompt = `다음 데이터를 기반으로 PAULVICE 머천다이징 전략을 수립해주세요.

## 컨텍스트
${task.task}

## 재고 데이터
${inventoryData ? JSON.stringify(inventoryData, null, 2) : "재고 데이터 없음 — 일반적 전략으로 응답"}

## 추가 입력
${JSON.stringify(inputs, null, 2)}

## 응답 JSON 형식
{
  "summary": "전략 요약",
  "category_reorder": [
    { "category": "카테고리명", "recommended_order": ["SKU1", "SKU2"], "rationale": "이유" }
  ],
  "pricing_changes": [
    { "sku": "SKU", "product_name": "상품명", "current_price": 0, "recommended_price": 0, "discount_pct": 0, "reason": "사유", "needs_approval": false, "duration_days": 7 }
  ],
  "bundle_suggestions": [
    { "name": "세트명", "products": ["상품1", "상품2"], "individual_total": 0, "bundle_price": 0, "discount_pct": 0, "rationale": "이유" }
  ],
  "main_page_changes": [
    { "section": "섹션명", "action": "add | remove | reorder", "products": ["상품명"], "rationale": "이유" }
  ],
  "aging_actions": [
    { "sku": "SKU", "product_name": "상품명", "days_in_stock": 0, "current_stock": 0, "aging_status": "상태", "recommended_discount": 0, "clearance_strategy": "전략", "needs_approval": false }
  ]
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
    let result: Record<string, unknown>;
    try {
      result = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    } catch {
      result = { raw_response: raw, parse_error: true };
    }

    events.push(createEvent("merch.updated", "merchandiser", {
      pricing_changes: Array.isArray(result.pricing_changes) ? (result.pricing_changes as unknown[]).length : 0,
      bundle_suggestions: Array.isArray(result.bundle_suggestions) ? (result.bundle_suggestions as unknown[]).length : 0,
      aging_actions: Array.isArray(result.aging_actions) ? (result.aging_actions as unknown[]).length : 0,
    }));

    return { agentId: "merchandiser", taskId: task.id, status: result.parse_error ? "partial" : "success", output: result, events, timestamp: new Date().toISOString() };
  } catch (err: unknown) {
    return { agentId: "merchandiser", taskId: task.id, status: "error", output: { error: err instanceof Error ? err.message : String(err) }, events: [], timestamp: new Date().toISOString() };
  }
}
