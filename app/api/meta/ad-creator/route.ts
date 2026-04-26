import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";

const SYSTEM = `당신은 한국 Meta 광고 제작 전문가이자 폴바이스(PAULVICE) 브랜드 전문가입니다.

브랜드 정보:
- 브랜드: 폴바이스 (PAULVICE) / @plve_seoul
- 제품: 여성 시계(미니엘 쁘띠, 에골라 오벌, 오드리), 각인 서비스
- 타겟: 20~30대 한국 직장 여성
- 창업자: 홍성조(남성) — 착용 시연 불가, 창업자/디자이너 포지션으로만 출연 가능

반드시 유효한 JSON만 출력하세요.`;

export async function POST(req: NextRequest) {
  const { product, goal, budget, period, additionalContext } = await req.json();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "API 키 없음" }, { status: 500 });

  const client = new Anthropic({ apiKey });

  const prompt = `다음 조건으로 폴바이스 Meta 광고 캠페인 전체 플랜을 작성해주세요.

광고 목적: ${goal}
주력 제품: ${product}
월 예산: ${budget}
집행 기간: ${period}
${additionalContext ? `추가 컨텍스트: ${additionalContext}` : ""}

아래 JSON 형식으로 완전한 광고 플랜을 작성하세요:

{
  "campaign": {
    "objective": "OUTCOME_SALES / OUTCOME_TRAFFIC / OUTCOME_AWARENESS 중 하나",
    "objectiveKo": "한국어 목적",
    "name": "권장 캠페인명",
    "bidStrategy": "입찰 전략",
    "budgetAllocation": "예산 배분 설명"
  },
  "adSets": [
    {
      "name": "광고 세트명",
      "role": "역할 (예: 신규 오디언스 탐색)",
      "targeting": {
        "age": "예: 23-35세",
        "gender": "여성",
        "interests": ["관심사1", "관심사2"],
        "behaviors": ["행동 타겟1"],
        "location": "대한민국",
        "customAudience": "리타겟팅이면 기술"
      },
      "placement": "권장 노출 위치",
      "dailyBudget": "일 예산",
      "optimizationGoal": "최적화 목표"
    }
  ],
  "creatives": [
    {
      "format": "릴스 / 단일이미지 / 카루셀 / 컬렉션 중 하나",
      "formatKo": "한국어 형식명",
      "headline": "광고 제목 (40자 이내)",
      "primaryText": "광고 본문 (125자 이내, 실제 사용 가능 문구)",
      "description": "설명 문구 (optional)",
      "cta": "지금 쇼핑하기 / 더 알아보기 등",
      "visualDirection": "촬영/편집 방향 (창업자 출연 제약 반영)",
      "hookLine": "첫 3초 훅 문구",
      "whyItWorks": "이 소재가 효과적인 이유"
    }
  ],
  "timeline": [
    { "week": "1주차", "action": "진행 내용" }
  ],
  "kpiBenchmarks": {
    "targetCTR": "목표 CTR",
    "targetCPM": "예상 CPM",
    "targetROAS": "목표 ROAS",
    "learningPhaseDays": 7
  },
  "tips": ["실행 팁 3~5개"]
}

adSets 2~3개, creatives 3개(다양한 형식), timeline 4주치.`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));

    return Response.json({ ...json, createdAt: new Date().toISOString() });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
