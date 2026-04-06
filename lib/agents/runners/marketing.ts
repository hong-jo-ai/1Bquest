/**
 * 마케팅 에이전트 (Marketing)
 * - Meta 광고 전략, SNS 발행, 프로모션 실행, 인플루언서 협업
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

const SYSTEM = `당신은 PAULVICE(폴바이스)의 마케팅 에이전트입니다.
Meta 광고 캠페인, 인스타그램/스레드 콘텐츠, 프로모션 실행, 인플루언서 협업을 관리합니다.

## 마케팅 채널
- Meta (Instagram + Facebook) 광고 — 월 300만원 예산
- Instagram 오가닉 — 피드 주 3-4회, 스토리 매일, 릴스 주 1-2회
- Threads — 주 5회+
- 인플루언서 협업 — 제품 협찬 + 유료 포스팅

## 리타겟팅 세그먼트
- 장바구니 이탈 (7일)
- 상세페이지 2회+ 방문
- 기존 구매자 (크로스셀)
- 유사 타겟 1%

반드시 JSON 형식으로만 응답하세요.`;

export async function runMarketing(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { agentId: "marketing", taskId: task.id, status: "error", output: { error: "ANTHROPIC_API_KEY 미설정" }, events: [], timestamp: new Date().toISOString() };
  }

  const inputs = task.inputs ?? {};

  const prompt = `다음 상황에 맞는 PAULVICE 마케팅 전략을 수립해주세요.

## 요청
${task.task}

## 입력 데이터
${JSON.stringify(inputs, null, 2)}

## 응답 JSON 형식
{
  "summary": "마케팅 전략 요약",
  "meta_campaigns": [
    {
      "name": "캠페인명",
      "objective": "CONVERSIONS | REACH | TRAFFIC",
      "daily_budget": 50000,
      "duration_days": 7,
      "audience": { "type": "retargeting | lookalike | interest", "segment": "세그먼트 설명" },
      "creative_direction": "크리에이티브 방향 (디자인 에이전트에 전달할 내용)",
      "copy_direction": "카피 방향 (카피라이팅 에이전트에 전달할 내용)",
      "placements": ["instagram_feed", "instagram_stories"]
    }
  ],
  "sns_schedule": [
    { "platform": "instagram | threads", "type": "feed | story | reels | post", "topic": "주제", "publish_time": "발행 시간대", "copy_ref": "카피 참조" }
  ],
  "influencer_actions": [
    { "action": "discover | dm | negotiate | ship", "target": "대상", "details": "상세" }
  ],
  "budget_allocation": { "meta_ads": 0, "influencer": 0, "content_production": 0, "total": 0 },
  "monitoring_plan": { "check_intervals_hours": [6, 24, 48], "kpis": ["roas", "ctr", "orders"] }
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

    events.push(createEvent("campaign.created", "marketing", {
      campaign_count: Array.isArray(result.meta_campaigns) ? (result.meta_campaigns as unknown[]).length : 0,
    }));

    return { agentId: "marketing", taskId: task.id, status: result.parse_error ? "partial" : "success", output: result, events, timestamp: new Date().toISOString() };
  } catch (err: unknown) {
    return { agentId: "marketing", taskId: task.id, status: "error", output: { error: err instanceof Error ? err.message : String(err) }, events: [], timestamp: new Date().toISOString() };
  }
}
