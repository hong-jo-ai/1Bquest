/**
 * 카피라이팅 에이전트 (Copywriter)
 * - 상세페이지, 배너, 프로모션, SEO, SNS 카피 생성
 * - PAULVICE 브랜드 보이스 준수
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

const SYSTEM = `당신은 PAULVICE(폴바이스)의 전담 카피라이터입니다.

## 브랜드 보이스
- 핵심 메시지: "시간을 디자인하다"
- 타겟: 20-30대 전문직 여성
- 톤: 우아하되 접근 가능한, 자신감 있는, 미니멀한 표현
- 한국어 자연스러운 문체, 번역체 금지

## 금지 표현
- "최저가", "떨이", "폭탄세일" 등 저가 이미지 표현
- 과도한 느낌표, "놓치면 후회" 류 압박성 문구
- 경쟁사 직접 비교/비하

요청에 따라 배너 카피, 상세페이지 카피, 프로모션 문구, SEO 메타 태그, SNS 카피를 생성합니다.
반드시 JSON 형식으로만 응답하세요.`;

export async function runCopywriter(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { agentId: "copywriter", taskId: task.id, status: "error", output: { error: "ANTHROPIC_API_KEY 미설정" }, events: [], timestamp: new Date().toISOString() };
  }

  const inputs = task.inputs ?? {};
  const copyType = (inputs.type as string) ?? "all";
  const productName = (inputs.product_name as string) ?? "폴바이스 시계";
  const context = (inputs.context as string) ?? "";
  const discount = inputs.discount_rate ?? "";

  const prompt = `다음 조건으로 PAULVICE 카피를 작성해주세요.

## 상품/상황
- 상품명: ${productName}
- 상황: ${context || task.task}
${discount ? `- 할인율: ${discount}%` : ""}

## 생성 요청 타입: ${copyType}

## 응답 JSON 형식
{
  "product_name": "${productName}",
  "banner_copy": [
    { "style": "promotional | seasonal | lifestyle", "main_text": "메인 카피", "sub_text": "서브 카피", "cta": "CTA 버튼" }
  ],
  "detail_page_copy": {
    "headline": "헤드라인",
    "subheadline": "서브 헤드라인",
    "body": "본문 (100자 내외)",
    "features": ["특장점1", "특장점2", "특장점3"],
    "cta": "CTA 문구"
  },
  "promotion_copy": {
    "title": "프로모션 제목",
    "description": "설명",
    "urgency": "긴급성 문구",
    "benefit": "혜택 설명"
  },
  "seo_meta": {
    "title": "SEO 타이틀 (60자 이내)",
    "description": "메타 디스크립션 (155자 이내)",
    "keywords": ["키워드1", "키워드2"]
  },
  "sns_copy": {
    "instagram": { "caption": "인스타 캡션", "hashtags": ["#태그1"], "hook": "첫줄 훅" },
    "threads": { "text": "스레드 텍스트", "style": "공감형 | 정보형 | 질문형" }
  }
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
    let copy: Record<string, unknown>;
    try {
      copy = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));
    } catch {
      copy = { raw_response: raw, parse_error: true };
    }

    events.push(createEvent("content.text.generated", "copywriter", { product: productName, type: copyType }));

    return { agentId: "copywriter", taskId: task.id, status: copy.parse_error ? "partial" : "success", output: copy, events, timestamp: new Date().toISOString() };
  } catch (err: unknown) {
    return { agentId: "copywriter", taskId: task.id, status: "error", output: { error: err instanceof Error ? err.message : String(err) }, events: [], timestamp: new Date().toISOString() };
  }
}
