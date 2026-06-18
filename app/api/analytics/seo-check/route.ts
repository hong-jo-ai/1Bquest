/**
 * 임시 SEO 점검 — harriotwatches GA4 속성의 채널별 세션(최근 90일)로 자연검색(Organic) 비중 확인.
 * 식스샵→카페24 이전 시 SEO 손실 리스크 가늠용. x-agent-token 인증.
 */
import { type NextRequest } from "next/server";
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-agent-token") !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = await getGoogleAccessTokenFromStore();
  if (!token) return Response.json({ error: "토큰 없음" }, { status: 502 });

  // 1) 접근 가능한 GA4 속성 목록 → harriot 속성 찾기
  const sumRes = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sum = await sumRes.json();
  const all: Array<{ id: string; name: string }> = (sum.accountSummaries ?? []).flatMap(
    (a: { propertySummaries?: { property: string; displayName: string }[] }) =>
      (a.propertySummaries ?? []).map((p) => ({ id: p.property, name: p.displayName })),
  );
  const wantId = req.nextUrl.searchParams.get("propId");
  const target = wantId
    ? all.find((p) => p.id.endsWith(wantId))
    : all.find((p) => /harriot|해리엇/i.test(p.name));
  if (!target) return Response.json({ note: "harriot 속성 못 찾음 — propId 지정 필요", properties: all });

  const propId = target.id.replace("properties/", "");
  // 2) 채널별 세션 (최근 90일)
  const rep = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: "90daysAgo", endDate: "today" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    }),
  });
  const j = await rep.json();
  const rows = (j.rows ?? []).map((r: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }) => ({
    channel: r.dimensionValues[0].value,
    sessions: Number(r.metricValues[0].value),
    users: Number(r.metricValues[1].value),
  }));
  const total = rows.reduce((s: number, r: { sessions: number }) => s + r.sessions, 0);
  const withPct = rows.map((r: { channel: string; sessions: number; users: number }) => ({ ...r, pct: total ? +((r.sessions / total) * 100).toFixed(1) : 0 }));
  return Response.json({ property: target.name, propId, totalSessions90d: total, channels: withPct, allProperties: all.map((p) => p.name) });
}
