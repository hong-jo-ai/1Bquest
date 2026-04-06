/**
 * 디자인 에이전트 (Designer)
 * - Gemini 3.1 Pro 이미지 생성 (향후)
 * - 현재는 Claude로 프롬프트 생성 + 이미지 가이드 출력
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

const SYSTEM = `당신은 PAULVICE(폴바이스)의 디자인 에이전트입니다.
Gemini 3.1 Pro 이미지 생성을 위한 프롬프트를 작성하고, 비주얼 가이드를 제공합니다.

## PAULVICE 비주얼 가이드라인
- 메인 컬러: 바이올렛/퍼플 (#7C3AED ~ #A78BFA)
- 배경: 미니멀 화이트/소프트 그레이
- 시계: 럭셔리 클로즈업, 자연광
- 모델: 20-30대 전문직 여성
- 타이포: 산세리프 한글, 깔끔한 레이아웃
- 금지: 네온컬러, 과도한 효과, 저해상도

각 이미지 유형에 맞는 Gemini 프롬프트를 작성합니다.
반드시 JSON 형식으로만 응답하세요.`;

export async function runDesigner(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { agentId: "designer", taskId: task.id, status: "error", output: { error: "ANTHROPIC_API_KEY 미설정" }, events: [], timestamp: new Date().toISOString() };
  }

  const inputs = task.inputs ?? {};

  const prompt = `다음 요청에 맞는 Gemini 3.1 Pro 이미지 생성 프롬프트를 작성해주세요.

## 요청
${task.task}

## 추가 정보
${JSON.stringify(inputs, null, 2)}

## 응답 JSON 형식
{
  "images": [
    {
      "type": "main_banner | category_banner | detail_page | instagram_feed | instagram_story | meta_ad | promo_banner",
      "size": "1920x600 | 1200x400 | 860x860 | 1080x1080 | 1080x1920 | 1200x628",
      "gemini_prompt": "영문 이미지 생성 프롬프트 (상세하게, PAULVICE 가이드라인 반영)",
      "description_kr": "이미지 설명 (한국어)",
      "text_overlay": { "main": "오버레이 메인 텍스트", "sub": "서브 텍스트", "cta": "CTA" },
      "style_notes": "스타일 참고사항"
    }
  ],
  "brand_consistency_notes": "브랜드 일관성 체크 사항",
  "gemini_api_ready": false,
  "note": "현재 Gemini API 키 미설정. 프롬프트만 생성됨. GEMINI_API_KEY 설정 후 자동 이미지 생성 가능."
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

    // Gemini API 연동 여부 표시
    result.gemini_api_ready = !!process.env.GEMINI_API_KEY;

    events.push(createEvent("content.image.generated", "designer", {
      image_count: Array.isArray(result.images) ? (result.images as unknown[]).length : 0,
      gemini_api_ready: result.gemini_api_ready,
    }));

    return { agentId: "designer", taskId: task.id, status: result.parse_error ? "partial" : "success", output: result, events, timestamp: new Date().toISOString() };
  } catch (err: unknown) {
    return { agentId: "designer", taskId: task.id, status: "error", output: { error: err instanceof Error ? err.message : String(err) }, events: [], timestamp: new Date().toISOString() };
  }
}
