import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import type { AnalyticsData } from "@/app/api/analytics/visitors/route";

const SYSTEM = `당신은 한국 이커머스 데이터 분석 전문가입니다.
폴바이스(PAULVICE) — 20~30대 직장 여성 타겟 여성 시계·주얼리 브랜드 — 의 Meta 광고 트래픽과 카페24 매출 데이터를 분석합니다.
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

  const T = analytics.totals;
  const daily = analytics.daily ?? [];
  const recent7 = daily.slice(-7);
  const prev7   = daily.slice(-14, -7);

  const r7 = {
    impressions:  recent7.reduce((s, d) => s + d.impressions, 0),
    clicks:       recent7.reduce((s, d) => s + d.clicks, 0),
    orders:       recent7.reduce((s, d) => s + d.orders, 0),
    revenue:      recent7.reduce((s, d) => s + d.revenue, 0),
    spend:        recent7.reduce((s, d) => s + d.spend, 0),
    landingViews: recent7.reduce((s, d) => s + d.landingViews, 0),
  };
  const p7 = {
    impressions:  prev7.reduce((s, d) => s + d.impressions, 0),
    clicks:       prev7.reduce((s, d) => s + d.clicks, 0),
    orders:       prev7.reduce((s, d) => s + d.orders, 0),
    revenue:      prev7.reduce((s, d) => s + d.revenue, 0),
    spend:        prev7.reduce((s, d) => s + d.spend, 0),
  };

  function pct(a: number, b: number) {
    return b > 0 ? `${((a - b) / b * 100).toFixed(1)}% 변화` : "비교불가";
  }

  const prompt = `아래는 폴바이스 최근 30일 광고 트래픽·매출 통합 데이터입니다.

## 30일 합계
- Meta 광고 노출: ${T.impressions.toLocaleString("ko-KR")}회 ${analytics.hasMeta ? "(실데이터)" : "(데이터 없음)"}
- Meta 광고 도달: ${T.reach.toLocaleString("ko-KR")}명
- Meta 광고 클릭: ${T.clicks.toLocaleString("ko-KR")}회 (CTR: ${T.ctr.toFixed(2)}%)
- Meta 랜딩뷰: ${T.landingViews.toLocaleString("ko-KR")}회
- Meta 광고 지출: ₩${T.spend.toLocaleString("ko-KR")}
- 카페24 주문: ${T.orders.toLocaleString("ko-KR")}건 ${analytics.hasCafe24 ? "(실데이터)" : "(데이터 없음)"}
- 카페24 매출: ₩${T.revenue.toLocaleString("ko-KR")}
- 클릭→주문 전환율: ${T.metaCvr.toFixed(2)}%
- 랜딩뷰→주문 전환율: ${(T as any).landingCvr != null ? (T as any).landingCvr.toFixed(2) : "0"}%
- 주문당 광고비(CPO): ₩${Math.round(T.cpo).toLocaleString("ko-KR")}
- 광고비 대비 매출(ROAS): ${T.roas.toFixed(2)}x

## 최근 7일 vs 이전 7일 비교
- 노출: ${r7.impressions.toLocaleString("ko-KR")} vs ${p7.impressions.toLocaleString("ko-KR")} (${pct(r7.impressions, p7.impressions)})
- 클릭: ${r7.clicks.toLocaleString("ko-KR")} vs ${p7.clicks.toLocaleString("ko-KR")} (${pct(r7.clicks, p7.clicks)})
- 주문: ${r7.orders} vs ${p7.orders} (${pct(r7.orders, p7.orders)})
- 매출: ₩${r7.revenue.toLocaleString("ko-KR")} vs ₩${p7.revenue.toLocaleString("ko-KR")} (${pct(r7.revenue, p7.revenue)})
- 광고지출: ₩${Math.round(r7.spend).toLocaleString("ko-KR")} vs ₩${Math.round(p7.spend).toLocaleString("ko-KR")}

## 최근 14일 일별 데이터
${daily.slice(-14).map(d =>
  `${d.date}: 노출 ${d.impressions.toLocaleString("ko-KR")} | 클릭 ${d.clicks} | 주문 ${d.orders}건 | 매출 ₩${d.revenue.toLocaleString("ko-KR")} | 광고비 ₩${Math.round(d.spend).toLocaleString("ko-KR")}`
).join("\n")}

위 데이터를 분석해서 아래 JSON 형식으로 응답해주세요:

{
  "summary": "전체 현황 2~3문장 요약",
  "keyFindings": ["핵심 발견사항 4~6개 (구체적 수치 포함)"],
  "concerns": [
    { "issue": "우려 사항", "detail": "구체적 설명 (수치 포함)", "priority": "high/medium/low" }
  ],
  "opportunities": [
    { "title": "기회 요인", "detail": "구체적 설명", "estimatedImpact": "예상 효과 (수치 포함)" }
  ],
  "weeklyTrend": "up/down/stable",
  "weeklyTrendComment": "최근 7일 트렌드 한 줄 코멘트",
  "conversionAdvice": ["전환율 개선 조언 3~4개"],
  "actionItems": [
    { "action": "구체적 조치", "deadline": "즉시/이번 주/이번 달", "expectedEffect": "기대 효과" }
  ],
  "overallScore": 75,
  "analyzedAt": "${new Date().toISOString()}"
}

concerns는 실제 수치 기반으로만, opportunities는 2~3개, actionItems는 3~4개.`;

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
