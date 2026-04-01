import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY_MISSING");
  return new Anthropic({ apiKey });
}

export interface DiscoveredInfluencer {
  handle: string;
  name: string;
  platform: "instagram" | "youtube" | "tiktok";
  followers: number;
  followersVerified?: boolean;   // true = Instagram에서 실제 확인, false = AI 추정
  engagementRate: number;
  categories: string[];
  reason: string;
  gender?: string;
  ageGroup?: string;
  nationality?: string;
  contentType?: string;
  source?: string;
}

// ── 블랙리스트 ──────────────────────────────────────────────────────
const BLACKLIST = new Set([
  "instagram","reels","reel","explore","stories","p","tv","accounts",
  "about","legal","privacy","help","download","business","creators",
  "press","api","blog","jobs","developer","graphql","static","cdninstagram",
  "naver","kakao","youtube","tiktok","facebook","twitter","line",
  "search","tags","location","ar","shop","lite","threadscx",
]);

// 핸들 유효성 검사 (너무 짧거나, 숫자만이거나, 유명 사이트명이면 제외)
function isValidHandle(h: string): boolean {
  return (
    h.length >= 4 &&
    h.length <= 30 &&
    !/^\d+$/.test(h) &&
    !BLACKLIST.has(h) &&
    /^[a-z0-9._]+$/.test(h) &&
    !h.startsWith("_") &&
    !h.endsWith("_")
  );
}

// ── 네이버 블로그 포스트 URL 추출 ─────────────────────────────────
async function getNaverBlogPostUrls(query: string): Promise<string[]> {
  try {
    const url = `https://search.naver.com/search.naver?where=post&query=${encodeURIComponent(query)}&display=10`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // 블로그 포스트 URL 추출
    const urls: string[] = [];
    const postPattern = /href="(https?:\/\/blog\.naver\.com\/[^"]+)"/g;
    const postPattern2 = /href="(https?:\/\/m\.blog\.naver\.com\/[^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = postPattern.exec(html)) !== null) urls.push(m[1]);
    while ((m = postPattern2.exec(html)) !== null) urls.push(m[1]);

    return [...new Set(urls)].slice(0, 6);
  } catch { return []; }
}

// ── 블로그 포스트 본문에서 Instagram 핸들 추출 ──────────────────────
async function extractHandlesFromPost(postUrl: string): Promise<string[]> {
  try {
    // 네이버 블로그는 iframe 구조 → PostView URL로 직접 접근
    // blog.naver.com/blogId/logNo → PostView.naver?blogId=...&logNo=...
    let fetchUrl = postUrl;
    const naverBlogMatch = postUrl.match(/blog\.naver\.com\/([^/]+)\/(\d+)/);
    if (naverBlogMatch) {
      const [, blogId, logNo] = naverBlogMatch;
      // 모바일 버전이 HTML 파싱에 더 유리
      fetchUrl = `https://m.blog.naver.com/${blogId}/${logNo}`;
    }

    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://search.naver.com/",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();

    const handles = new Set<string>();

    // instagram.com/핸들 패턴
    const instaUrl = /instagram\.com\/([a-zA-Z0-9._]{4,30})(?:\/|\?|"|'|&|\s|<|>)/g;
    let m: RegExpExecArray | null;
    while ((m = instaUrl.exec(html)) !== null) {
      const h = m[1].toLowerCase().replace(/\.+$/, "");
      if (isValidHandle(h)) handles.add(h);
    }

    // @핸들 패턴 (본문에 자주 등장)
    const atPat = /@([a-zA-Z0-9._]{4,30})(?=[^a-zA-Z0-9._]|$)/g;
    while ((m = atPat.exec(html)) !== null) {
      const h = m[1].toLowerCase().replace(/\.+$/, "");
      if (isValidHandle(h)) handles.add(h);
    }

    return Array.from(handles);
  } catch { return []; }
}

// ── 네이버 검색으로 실제 핸들 수집 ──────────────────────────────────
async function collectRealHandles(queries: string[]): Promise<{ handle: string; source: string }[]> {
  const found: { handle: string; source: string }[] = [];
  const seen = new Set<string>();

  for (const query of queries.slice(0, 4)) {
    // 1단계: 블로그 포스트 URL 수집
    const postUrls = await getNaverBlogPostUrls(query);

    // 2단계: 각 포스트 본문에서 핸들 추출
    await Promise.all(
      postUrls.map(async (postUrl) => {
        const handles = await extractHandlesFromPost(postUrl);
        for (const h of handles) {
          if (!seen.has(h)) {
            seen.add(h);
            found.push({ handle: h, source: postUrl });
          }
        }
      })
    );

    if (found.length >= 20) break;
  }

  return found;
}

// ── Instagram 실제 팔로워 수 조회 ────────────────────────────────────
async function fetchRealFollowers(handle: string): Promise<number | null> {
  // 방법 1: Instagram 내부 API
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
          "x-ig-app-id": "936619743392459",
          "Referer": "https://www.instagram.com/",
          "Origin": "https://www.instagram.com",
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      const count = data?.data?.user?.edge_followed_by?.count;
      if (typeof count === "number") return count;
    }
  } catch { /* 다음 방법 시도 */ }

  // 방법 2: 프로필 HTML 파싱
  try {
    const res = await fetch(`https://www.instagram.com/${handle}/`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // JSON 임베딩에서 팔로워 수 추출
    const m = html.match(/"edge_followed_by":\{"count":(\d+)\}/) ||
              html.match(/"follower_count":(\d+)/) ||
              html.match(/,"followers":(\d+),/);
    if (m) return parseInt(m[1]);
  } catch { /* */ }

  return null;
}

// ── Claude로 핸들 분석 (관대하게) ───────────────────────────────────
async function enrichHandles(
  client: Anthropic,
  handles: { handle: string; source: string }[],
  params: {
    platform: string; categories: string; gender: string; ageGroup: string;
    nationality: string; followerMin: number; followerMax: number;
    contentGuide: string; extraGuide: string; batch: number;
  }
): Promise<DiscoveredInfluencer[]> {

  const handleList = handles.map((h) => `@${h.handle}`).join(", ");

  const prompt = `
당신은 한국 인플루언서 마케팅 전문가입니다.

아래는 한국 패션/라이프스타일 블로그에서 언급된 실제 Instagram 계정 핸들 목록입니다:
${handleList}

PAULVICE 브랜드 조건:
- 프리미엄 시계/럭셔리 액세서리 브랜드 (한국)
- 카테고리: ${params.categories}${params.gender ? `\n- 성별 선호: ${params.gender}` : ""}${params.ageGroup ? `\n- 연령대: ${params.ageGroup}` : ""}${params.contentGuide ? `\n- 콘텐츠 유형: ${params.contentGuide}` : ""}${params.extraGuide ? `\n- 추가 조건: ${params.extraGuide}` : ""}

위 핸들 목록에서 인플루언서로 보이는 계정(개인 이름/닉네임 스타일, 패션/라이프스타일 관련)을 골라 최대 15개의 프로필을 작성해주세요.

중요:
- 핸들 자체는 절대 수정하지 마세요
- followers는 반드시 0으로 설정하세요 (실제 팔로워 수는 별도로 조회합니다)
- JSON 배열만 반환하세요:

[
  {
    "handle": "핸들(@ 없이, 수정 금지)",
    "name": "추정 한국어 이름 또는 닉네임",
    "platform": "instagram",
    "followers": 0,
    "engagementRate": 추정 참여율(1.0~8.0),
    "categories": ["카테고리"],
    "gender": "남성 또는 여성",
    "ageGroup": "20대 또는 30대 등",
    "nationality": "한국인",
    "contentType": "주요 콘텐츠 한 줄",
    "reason": "PAULVICE 협업 적합 이유 (한국어)"
  }
]

인플루언서처럼 보이지 않는 핸들(브랜드 공식 계정, 뉴스 계정 등)은 제외하고, 나머지는 최대한 포함해주세요.
`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const result: DiscoveredInfluencer[] = JSON.parse(jsonMatch[0]);
    const sourceMap = Object.fromEntries(handles.map((h) => [h.handle, h.source]));

    return result
      .filter((inf) => inf && inf.handle)
      .map((inf) => ({
        ...inf,
        handle: inf.handle.replace(/^@/, "").toLowerCase(),
        followers: Math.max(500, Math.min(10_000_000, inf.followers || 10000)),
        engagementRate: Math.max(0.5, Math.min(15, inf.engagementRate || 2.5)),
        categories: Array.isArray(inf.categories) ? inf.categories : [],
        source: sourceMap[inf.handle.replace(/^@/, "").toLowerCase()] || "",
      }));
  } catch (e) {
    console.error("enrichHandles error:", e);
    return [];
  }
}

// ── 검색 쿼리 생성 ─────────────────────────────────────────────────
function buildQueries(params: {
  categories: string; gender: string; ageGroup: string;
  contentGuide: string; extraGuide: string; batch: number;
}): string[] {
  const cats = params.categories.split(",").filter(Boolean);
  const queries = [
    `인스타그램 ${cats[0] || "패션"} 인플루언서 추천`,
    `${cats[0] || "패션"} 인스타그램 협찬 인플루언서`,
    `한국 인스타그램 ${cats.join(" ")} 인플루언서`,
    `인스타그램 시계 패션 인플루언서 추천`,
    `럭셔리 라이프스타일 인스타그램 계정 추천`,
    `패션 인플루언서 인스타 팔로우 추천`,
    `남성 패션 인스타그램 인플루언서`,
    `여성 패션 인스타그램 인플루언서 추천`,
  ];

  if (params.gender) queries.unshift(`${params.gender} 인스타그램 인플루언서 추천`);
  if (params.contentGuide) queries.unshift(`${params.contentGuide} 인스타그램`);
  if (params.extraGuide) queries.unshift(params.extraGuide + " 인스타그램");

  // 배치마다 다른 쿼리 사용
  const offset = (params.batch * 3) % queries.length;
  return [...queries.slice(offset), ...queries.slice(0, offset)];
}

// ── Main Handler ──────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const batch        = parseInt(searchParams.get("batch") || "0");
  const categories   = searchParams.get("categories") || "패션,럭셔리,라이프스타일";
  const platform     = searchParams.get("platform") || "instagram";
  const gender       = searchParams.get("gender") || "";
  const ageGroup     = searchParams.get("ageGroup") || "";
  const nationality  = searchParams.get("nationality") || "";
  const followerMin  = parseInt(searchParams.get("followerMin") || "10000");
  const followerMax  = parseInt(searchParams.get("followerMax") || "200000");
  const contentGuide = searchParams.get("contentGuide") || "";
  const extraGuide   = searchParams.get("extraGuide") || "";

  let client: Anthropic;
  try { client = getClient(); }
  catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY_MISSING" }, { status: 503 }
    );
  }

  try {
    const queries = buildQueries({ categories, gender, ageGroup, contentGuide, extraGuide, batch });
    const handles = await collectRealHandles(queries);

    // 디버그: 실제 수집된 핸들 로그
    console.log(`[discover] 수집된 핸들 ${handles.length}개:`, handles.slice(0, 10).map(h => h.handle));

    if (handles.length === 0) {
      return NextResponse.json({
        error: "NAVER_NO_RESULTS",
        message: "블로그 포스트에서 Instagram 계정을 찾지 못했습니다. 잠시 후 다시 시도해주세요.",
        foundHandles: 0,
        debug: { queries: queries.slice(0, 3) },
      }, { status: 422 });
    }

    const enriched = await enrichHandles(client!, handles, {
      platform, categories, gender, ageGroup, nationality,
      followerMin, followerMax, contentGuide, extraGuide, batch,
    });

    if (enriched.length === 0) {
      return NextResponse.json({
        error: "NAVER_NO_RESULTS",
        message: "Instagram 계정을 분석하지 못했습니다. 다시 시도해주세요.",
        foundHandles: handles.length,
      }, { status: 422 });
    }

    // ── 실제 팔로워 수 병렬 조회 ────────────────────────────────────
    console.log(`[discover] 팔로워 수 확인 시작: ${enriched.length}개`);
    const withRealFollowers = await Promise.all(
      enriched.map(async (inf) => {
        const real = await fetchRealFollowers(inf.handle);
        console.log(`[discover] @${inf.handle}: ${real !== null ? real.toLocaleString() : "조회 실패"}`);
        if (real !== null) {
          return { ...inf, followers: real, followersVerified: true };
        }
        return { ...inf, followersVerified: false };
      })
    );

    // ── 팔로워 범위 필터 ─────────────────────────────────────────────
    // 팔로워가 확인된 계정은 범위 밖이면 제외
    // 팔로워 조회 실패 계정은 일단 포함 (사용자가 직접 확인)
    const filtered = withRealFollowers.filter((inf) => {
      if (!inf.followersVerified) return true;
      return inf.followers >= followerMin && inf.followers <= followerMax;
    });

    const verifiedCount = withRealFollowers.filter((i) => i.followersVerified).length;
    const filteredOutCount = withRealFollowers.length - filtered.length;

    console.log(`[discover] 확인됨: ${verifiedCount}/${withRealFollowers.length}, 범위 밖 제외: ${filteredOutCount}개`);

    // 필터 후 0개이면 범위 조건을 완화해서 확인된 계정이라도 반환
    const finalList = filtered.length > 0 ? filtered : withRealFollowers.slice(0, 10);

    return NextResponse.json({
      influencers: finalList,
      batch,
      source: "naver_search",
      foundHandles: handles.length,
      verifiedCount,
      filteredOutCount,
    });

  } catch (err) {
    console.error("Discover error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
