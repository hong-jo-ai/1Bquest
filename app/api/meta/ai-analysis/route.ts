import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import type { MetaCampaign } from "@/lib/metaData";

const SYSTEM = `당신은 한국 Meta(Facebook/Instagram) 광고 전문가입니다.
폴바이스(PAULVICE) — 20~30대 직장 여성 타겟 여성 시계·주얼리 브랜드 — 의 광고 계정을 분석합니다.
반드시 유효한 JSON만 출력하세요.`;

export async function POST(req: NextRequest) {
  const { campaigns }: { campaigns: MetaCampaign[] } = await req.json();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "API 키 없음" }, { status: 500 });

  const client = new Anthropic({ apiKey });

  const campaignSummary = campaigns.map(c => ({
    이름: c.name, 상태: c.status, 목적: c.objective,
    지출: `₩${Math.round(c.spend).toLocaleString("ko-KR")}`,
    노출: c.impressions, 클릭: c.clicks,
    CTR: `${c.ctr.toFixed(2)}%`, CPM: `₩${Math.round(c.cpm).toLocaleString("ko-KR")}`,
    ROAS: c.roas > 0 ? `${c.roas.toFixed(2)}x` : "측정불가",
    빈도: c.frequency.toFixed(1),
    일예산: c.dailyBudget > 0 ? `₩${Math.round(c.dailyBudget / 100).toLocaleString("ko-KR")}` : "미설정",
    운영일: c.createdTime ? `${Math.floor((Date.now() - new Date(c.createdTime).getTime()) / 86400000)}일` : "불명",
  }));

  const prompt = `아래는 폴바이스 Meta 광고 계정의 캠페인 현황입니다:

${JSON.stringify(campaignSummary, null, 2)}

위 데이터를 분석해서 아래 JSON 형식으로 응답해주세요:

{
  "pauseNow": [
    { "campaignName": "캠페인명", "reason": "중단해야 하는 이유", "urgency": "즉시/1주내", "action": "구체적 조치" }
  ],
  "increaseBudget": [
    { "campaignName": "캠페인명", "reason": "증액 이유", "suggestedIncrease": "예: 30% 증액", "expectedEffect": "기대 효과" }
  ],
  "newCampaigns": [
    { "type": "캠페인 유형", "objective": "목적", "reason": "추가해야 하는 이유", "targetAudience": "타겟 오디언스", "suggestedBudget": "예: 일 3만원" }
  ],
  "insights": [
    "전체 계정에 대한 핵심 인사이트 (5~7개 bullet)"
  ],
  "overallScore": 75,
  "overallComment": "전체 광고 계정 상태 한 줄 평가"
}

pauseNow/increaseBudget은 실제 데이터 기반으로만, newCampaigns는 2~3개, insights는 5~7개.`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));

    return Response.json({ ...json, analyzedAt: new Date().toISOString() });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
