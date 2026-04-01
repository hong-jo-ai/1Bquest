import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import type { AnalyticsData } from "@/app/api/analytics/visitors/route";

const SYSTEM = `당신은 한국 이커머스 데이터 분석 전문가입니다.
폴바이스(PAULVICE) — 20~30대 직장 여성 타겟 여성 시계·주얼리 브랜드 — 의 쇼핑몰 방문자 및 매출 데이터를 분석합니다.
반드시 유효한 JSON만 출력하세요. 한국어로 작성하세요.`;

export interface AnalyticsAIResult {
  summary: string;
  keyFindings: string[];
  concerns: { issue: string; detail: string; priority: "high" | "medium" | "low" }[];
  opportunities: { title: string; detail: string; estimatedImpact: string }[];
  weeklyTrend: "up" | "down" | "stable";
  weeklyTrendComment: string;
  conversionAdvice: string[];
  actionItems: { action: string; deadline: string; expectedEffect: string }[];
  overallScore: number;
  analyzedAt: string;
}

export async function POST(req: NextRequest) {
  const { analytics }: { analytics: AnalyticsData } = await req.json();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "API 키 없음" }, { status: 500 });

  const client = new Anthropic({ apiKey });

  // 최근 7일 vs 이전 7일 비교
  const daily = analytics.daily ?? [];
  const recent7 = daily.slice(-7);
  const prev7 = daily.slice(-14, -7);

  const recentOrders = recent7.reduce((s, d) => s + d.orders, 0);
  const prevOrders = prev7.reduce((s, d) => s + d.orders, 0);
  const recentRevenue = recent7.reduce((s, d) => s + d.revenue, 0);
  const prevRevenue = prev7.reduce((s, d) => s + d.revenue, 0);
  const recentVisitors = recent7.reduce((s, d) => s + d.visitors, 0);
  const prevVisitors = prev7.reduce((s, d) => s + d.visitors, 0);

  const prompt = `아래는 폴바이스 쇼핑몰 최근 30일 방문자·매출 데이터입니다.

## 개요 (30일 합계)
- 총 방문자: ${analytics.overview.totalVisitors.toLocaleString("ko-KR")}명 ${analytics.overview.hasRealAnalytics ? "(실제 데이터)" : "(방문자 데이터 없음, 주문 기반)"}
- 총 주문: ${analytics.overview.totalOrders.toLocaleString("ko-KR")}건
- 총 매출: ₩${analytics.overview.totalRevenue.toLocaleString("ko-KR")}
- 평균 전환율: ${analytics.overview.avgConversionRate}%
- 평균 이탈률: ${analytics.overview.avgBounceRate > 0 ? analytics.overview.avgBounceRate + "%" : "데이터 없음"}

## 최근 7일 vs 이전 7일
- 방문자: ${recentVisitors.toLocaleString("ko-KR")} vs ${prevVisitors.toLocaleString("ko-KR")} (${recentVisitors > 0 && prevVisitors > 0 ? ((recentVisitors - prevVisitors) / prevVisitors * 100).toFixed(1) + "% 변화" : "비교 불가"})
- 주문수: ${recentOrders} vs ${prevOrders} (${prevOrders > 0 ? ((recentOrders - prevOrders) / prevOrders * 100).toFixed(1) + "% 변화" : "비교 불가"})
- 매출: ₩${recentRevenue.toLocaleString("ko-KR")} vs ₩${prevRevenue.toLocaleString("ko-KR")}

## 일별 데이터 (최근 14일)
${daily.slice(-14).map(d => `${d.date}: 방문자 ${d.visitors}, 주문 ${d.orders}건, 매출 ₩${d.revenue.toLocaleString("ko-KR")}`).join("\n")}

## 유입 경로
${analytics.trafficSources.map(s => `${s.name}: ${s.visits.toLocaleString("ko-KR")}회 (${s.pct}%)`).join(", ")}

## 인기 검색 키워드
${analytics.topKeywords.slice(0, 5).map(k => `"${k.keyword}" (${k.visits}회)`).join(", ") || "없음"}

위 데이터를 분석해서 아래 JSON 형식으로 응답해주세요:

{
  "summary": "전체 현황 2~3문장 요약",
  "keyFindings": ["핵심 발견사항 4~6개"],
  "concerns": [
    { "issue": "우려 사항", "detail": "구체적 설명", "priority": "high/medium/low" }
  ],
  "opportunities": [
    { "title": "기회 요인", "detail": "구체적 설명", "estimatedImpact": "예상 효과" }
  ],
  "weeklyTrend": "up/down/stable",
  "weeklyTrendComment": "최근 7일 트렌드 한 줄 코멘트",
  "conversionAdvice": ["전환율 개선 조언 3~4개"],
  "actionItems": [
    { "action": "구체적 조치", "deadline": "이번 주/이번 달/즉시", "expectedEffect": "기대 효과" }
  ],
  "overallScore": 75,
  "analyzedAt": "${new Date().toISOString()}"
}

concerns는 실제 문제점만, opportunities는 2~3개, actionItems는 3~4개.`;

  try {
    const res = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));

    return Response.json({ ...json, analyzedAt: new Date().toISOString() } as AnalyticsAIResult);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
