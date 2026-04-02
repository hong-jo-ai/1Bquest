const GA4_BASE = "https://analyticsdata.googleapis.com/v1beta/properties";
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

export interface Ga4DailyRow {
  date: string;        // YYYYMMDD → YYYY-MM-DD 변환
  users: number;
  newUsers: number;
  sessions: number;
  pageviews: number;
  bounceRate: number;  // 0~1
  avgSessionSec: number;
}

export interface Ga4TrafficSource {
  channel: string;
  sessions: number;
  pct: number;
}

export interface Ga4DeviceRow {
  device: string;
  sessions: number;
  pct: number;
}

export interface Ga4Data {
  daily: Ga4DailyRow[];
  trafficSources: Ga4TrafficSource[];
  devices: Ga4DeviceRow[];
  totals: {
    users: number;
    newUsers: number;
    sessions: number;
    pageviews: number;
    avgBounceRate: number;
    avgSessionMin: number;
  };
}

// ── 토큰 갱신 ─────────────────────────────────────────────────────────────

export async function refreshGoogleToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google 토큰 갱신 실패: ${await res.text()}`);
  const json = await res.json() as { access_token: string };
  return json.access_token;
}

// ── GA4 Report 호출 ───────────────────────────────────────────────────────

async function runReport(propertyId: string, token: string, body: object) {
  const res = await fetch(`${GA4_BASE}/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GA4 API [${res.status}]: ${await res.text()}`);
  return res.json();
}

// ── 메인 GA4 데이터 조회 (30일) ───────────────────────────────────────────

export async function fetchGa4Data(propertyId: string, token: string): Promise<Ga4Data> {
  const dateRange = { startDate: "29daysAgo", endDate: "today" };

  const [dailyRes, sourceRes, deviceRes] = await Promise.all([
    // 일별 기본 지표
    runReport(propertyId, token, {
      dateRanges: [dateRange],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "bounceRate" },
        { name: "averageSessionDuration" },
      ],
      orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
    }),
    // 유입 채널별
    runReport(propertyId, token, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    }),
    // 기기별
    runReport(propertyId, token, {
      dateRanges: [dateRange],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "sessions" }],
    }),
  ]);

  // ── 일별 파싱 ──────────────────────────────────────────────────────────
  const daily: Ga4DailyRow[] = (dailyRes.rows ?? []).map((row: any) => {
    const [d, u, nu, s, pv, br, asd] = [
      row.dimensionValues?.[0]?.value ?? "",
      row.metricValues?.[0]?.value   ?? "0",
      row.metricValues?.[1]?.value   ?? "0",
      row.metricValues?.[2]?.value   ?? "0",
      row.metricValues?.[3]?.value   ?? "0",
      row.metricValues?.[4]?.value   ?? "0",
      row.metricValues?.[5]?.value   ?? "0",
    ];
    // YYYYMMDD → YYYY-MM-DD
    const date = d.length === 8
      ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
      : d;
    return {
      date,
      users:         parseInt(u,  10),
      newUsers:      parseInt(nu, 10),
      sessions:      parseInt(s,  10),
      pageviews:     parseInt(pv, 10),
      bounceRate:    parseFloat(br),
      avgSessionSec: parseFloat(asd),
    };
  });

  // ── 유입 채널 파싱 ─────────────────────────────────────────────────────
  const totalSessions = (sourceRes.rows ?? []).reduce(
    (s: number, r: any) => s + parseInt(r.metricValues?.[0]?.value ?? "0", 10),
    0
  );
  const CHANNEL_KO: Record<string, string> = {
    "Organic Search":  "검색 유입",
    "Direct":          "직접 유입",
    "Paid Social":     "유료 소셜",
    "Organic Social":  "소셜 유입",
    "Referral":        "외부 링크",
    "Email":           "이메일",
    "Paid Search":     "유료 검색",
    "Affiliates":      "제휴",
    "Display":         "디스플레이",
    "(Other)":         "기타",
    "Unassigned":      "미분류",
  };
  const trafficSources: Ga4TrafficSource[] = (sourceRes.rows ?? []).map((row: any) => {
    const ch   = row.dimensionValues?.[0]?.value ?? "기타";
    const sess = parseInt(row.metricValues?.[0]?.value ?? "0", 10);
    return {
      channel: CHANNEL_KO[ch] ?? ch,
      sessions: sess,
      pct: totalSessions > 0 ? Math.round((sess / totalSessions) * 100) : 0,
    };
  });

  // ── 기기 파싱 ──────────────────────────────────────────────────────────
  const totalDev = (deviceRes.rows ?? []).reduce(
    (s: number, r: any) => s + parseInt(r.metricValues?.[0]?.value ?? "0", 10),
    0
  );
  const DEVICE_KO: Record<string, string> = {
    mobile:  "모바일",
    desktop: "데스크탑",
    tablet:  "태블릿",
  };
  const devices: Ga4DeviceRow[] = (deviceRes.rows ?? []).map((row: any) => {
    const dev  = row.dimensionValues?.[0]?.value ?? "";
    const sess = parseInt(row.metricValues?.[0]?.value ?? "0", 10);
    return {
      device: DEVICE_KO[dev] ?? dev,
      sessions: sess,
      pct: totalDev > 0 ? Math.round((sess / totalDev) * 100) : 0,
    };
  });

  // ── 합계 ──────────────────────────────────────────────────────────────
  const totUsers    = daily.reduce((s, d) => s + d.users, 0);
  const totNew      = daily.reduce((s, d) => s + d.newUsers, 0);
  const totSessions = daily.reduce((s, d) => s + d.sessions, 0);
  const totPV       = daily.reduce((s, d) => s + d.pageviews, 0);
  const brDays      = daily.filter(d => d.bounceRate > 0);
  const avgBounce   = brDays.length > 0
    ? brDays.reduce((s, d) => s + d.bounceRate, 0) / brDays.length
    : 0;
  const avgDur      = daily.filter(d => d.avgSessionSec > 0);
  const avgSec      = avgDur.length > 0
    ? avgDur.reduce((s, d) => s + d.avgSessionSec, 0) / avgDur.length
    : 0;

  return {
    daily,
    trafficSources,
    devices,
    totals: {
      users:        totUsers,
      newUsers:     totNew,
      sessions:     totSessions,
      pageviews:    totPV,
      avgBounceRate: Math.round(avgBounce * 1000) / 10,
      avgSessionMin: Math.round(avgSec / 6) / 10,
    },
  };
}
