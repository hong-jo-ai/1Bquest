import Anthropic from "@anthropic-ai/sdk";
import { type NextRequest } from "next/server";
import { cookies } from "next/headers";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 없음");
  return new Anthropic({ apiKey });
}

// ── 소스별 수집 함수 ──────────────────────────────────────────────────────

/** 1. YouTube Data API v3 — 인기 쇼츠 제목 수집 */
async function fetchYouTubeShorts(
  keywords: string[]
): Promise<{ data: string; active: boolean }> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { data: "", active: false };

  try {
    const q = encodeURIComponent(keywords.slice(0, 2).join(" ") + " shorts");
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&q=${q}&regionCode=KR&relevanceLanguage=ko&order=viewCount&maxResults=10&key=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { data: "", active: false };
    const json = await res.json();
    const titles: string[] =
      json.items
        ?.map((item: any) => item.snippet?.title)
        .filter(Boolean)
        .slice(0, 8) ?? [];
    if (!titles.length) return { data: "", active: false };
    return {
      data: `유튜브 인기 쇼츠 제목: ${titles.join(" | ")}`,
      active: true,
    };
  } catch {
    return { data: "", active: false };
  }
}

/** 2. Naver DataLab API (공식) — 검색량 트렌드 */
async function fetchNaverDataLab(
  keywords: string[]
): Promise<{ data: string; active: boolean }> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return { data: "", active: false };

  try {
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const body = {
      startDate,
      endDate,
      timeUnit: "week",
      keywordGroups: keywords.slice(0, 5).map((kw) => ({
        groupName: kw,
        keywords: [kw],
      })),
    };

    const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return { data: "", active: false };
    const json = await res.json();

    const results: string[] =
      json.results?.map((r: any) => {
        const latest = r.data?.slice(-2) ?? [];
        const avg =
          latest.reduce((sum: number, d: any) => sum + (d.ratio ?? 0), 0) /
          (latest.length || 1);
        return `${r.title}: ${avg.toFixed(1)}`;
      }) ?? [];

    if (!results.length) return { data: "", active: false };
    return {
      data: `네이버 검색 트렌드 (최근 4주 검색지수): ${results.join(", ")}`,
      active: true,
    };
  } catch {
    return { data: "", active: false };
  }
}

/** 3. Google Trends 실시간 검색어 (RSS 피드) */
async function fetchGoogleTrends(): Promise<{ data: string; active: boolean }> {
  try {
    const res = await fetch(
      "https://trends.google.com/trending/rss?geo=KR",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { data: "", active: false };
    const xml = await res.text();
    // <title> 태그에서 검색어 추출 (첫 번째는 피드 제목이므로 skip)
    const matches = [...xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g)]
      .map((m) => (m[1] || m[2] || "").trim())
      .filter((t) => t && t !== "Daily Search Trends")
      .slice(0, 10);
    if (!matches.length) return { data: "", active: false };
    return {
      data: `구글 실시간 검색 트렌드: ${matches.join(", ")}`,
      active: true,
    };
  } catch {
    return { data: "", active: false };
  }
}

/** 4. Meta Graph API — 내 인스타 계정 최근 포스트 성과 */
async function fetchMetaInsights(
  token: string
): Promise<{ data: string; active: boolean }> {
  if (!token) return { data: "", active: false };
  const igUserId = process.env.META_INSTAGRAM_USER_ID;
  if (!igUserId) return { data: "", active: false };

  try {
    const mediaRes = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count&limit=15&access_token=${token}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!mediaRes.ok) return { data: "", active: false };
    const mediaJson = await mediaRes.json();
    if (!mediaJson.data?.length) return { data: "", active: false };

    const posts: string[] = mediaJson.data
      .sort(
        (a: any, b: any) =>
          b.like_count + b.comments_count * 3 -
          (a.like_count + a.comments_count * 3)
      )
      .slice(0, 5)
      .map(
        (p: any) =>
          `[${p.media_type}] 좋아요 ${p.like_count} 댓글 ${p.comments_count}: ${(p.caption ?? "").slice(0, 60)}`
      );

    return {
      data: `내 인스타 최근 상위 5개 포스트:\n${posts.join("\n")}`,
      active: true,
    };
  } catch {
    return { data: "", active: false };
  }
}

/** 5. Claude 웹검색 — 최신 SNS 트렌드 검색 */
async function fetchClaudeWebSearch(
  keywords: string[]
): Promise<{ data: string; active: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { data: "", active: false };

  try {
    const client = new Anthropic({ apiKey });
    const query = `${keywords.slice(0, 3).join(" ")} 인스타그램 릴스 유튜브 쇼츠 트렌드 2025 한국`;

    const res = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }] as any,
      messages: [
        {
          role: "user",
          content: `"${query}" 키워드로 최신 한국 SNS 콘텐츠 트렌드를 검색하고, 패션·시계 브랜드 마케팅에 적용 가능한 주요 트렌드 포인트 5가지를 간결하게 요약해주세요.`,
        },
      ],
    });

    const text = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    if (!text) return { data: "", active: false };
    return { data: `Claude 웹검색 인사이트:\n${text}`, active: true };
  } catch {
    return { data: "", active: false };
  }
}

// ── 시스템 프롬프트 ───────────────────────────────────────────────────────

const SYSTEM = `당신은 한국 패션·라이프스타일 SNS 콘텐츠 트렌드 전문가입니다.
폴바이스(PAULVICE) — 20~30대 직장 여성 타겟 여성 시계 브랜드 — 의 관점에서 분석합니다.
인스타그램 릴스, 유튜브 쇼츠, 쓰레드 등 숏폼·SNS 콘텐츠 트렌드에 집중하세요.
반드시 유효한 JSON만 출력하세요.`;

// ── 메인 핸들러 ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { keywords = ["패션 시계", "여성 액세서리", "출근룩", "직장인 코디"] } =
    await req.json();

  const cookieStore = await cookies();
  const metaToken = cookieStore.get("meta_at")?.value ?? "";

  // 모든 소스 병렬 수집
  const [youtubeResult, naverResult, googleResult, metaResult, webSearchResult] =
    await Promise.all([
      fetchYouTubeShorts(keywords),
      fetchNaverDataLab(keywords),
      fetchGoogleTrends(),
      fetchMetaInsights(metaToken),
      fetchClaudeWebSearch(keywords),
    ]);

  const sources = {
    youtube:   { active: youtubeResult.active,   label: "YouTube Shorts" },
    naver:     { active: naverResult.active,     label: "Naver DataLab" },
    google:    { active: googleResult.active,    label: "Google Trends" },
    meta:      { active: metaResult.active,      label: "Instagram 인사이트" },
    webSearch: { active: webSearchResult.active, label: "Claude 웹검색" },
  };

  const webContext = [
    youtubeResult.data,
    naverResult.data,
    googleResult.data,
    metaResult.data,
    webSearchResult.data,
  ]
    .filter(Boolean)
    .join("\n\n");

  const client = getClient();

  const prompt = `다음 정보를 참고해서 현재 한국 SNS에서 패션·시계·액세서리 콘텐츠 트렌드를 분석해주세요.

분석 키워드: ${keywords.join(", ")}
${webContext ? `\n수집된 실시간 데이터:\n${webContext}` : ""}

폴바이스 인스타/유튜브 콘텐츠에 바로 적용 가능한 트렌드를 분석해주세요.

아래 JSON 구조로만 응답하세요:
{
  "viralHooks": [
    { "hook": "후킹 문구 패턴", "example": "폴바이스 버전 예시", "platform": "릴스/쇼츠/공통" }
  ],
  "contentFormats": [
    { "name": "포맷명", "desc": "설명", "whyWorks": "왜 요즘 잘 되는지", "paulviceFit": "폴바이스 적용 방법" }
  ],
  "trendingThemes": [
    { "theme": "테마", "insight": "인사이트", "angle": "폴바이스 각도" }
  ],
  "searchKeywords": [
    { "keyword": "키워드", "intent": "검색 의도", "difficulty": "상/중/하" }
  ],
  "quickTips": ["즉시 적용 가능한 팁"]
}

viralHooks 8개, contentFormats 5개, trendingThemes 5개, searchKeywords 6개, quickTips 6개`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 3500,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (res.content[0] as { text: string }).text.trim();
    const json = raw.startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(raw.replace(/^```json\n?/, "").replace(/\n?```$/, ""));

    return Response.json({
      keywords,
      generatedAt: new Date().toISOString(),
      sources,
      ...json,
    });
  } catch (e: any) {
    return Response.json(
      { error: e.message ?? "트렌드 분석 실패" },
      { status: 500 }
    );
  }
}
