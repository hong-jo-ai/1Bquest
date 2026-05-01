/**
 * 인플루언서 프로필 사진 프록시.
 *
 * 클라이언트는 `/api/influencer/avatar?platform=instagram&handle=hong_sj` 같이 호출.
 * 서버가 플랫폼별로 프로필 사진 URL을 찾아서 이미지 바이트로 응답.
 *
 *   - instagram: 프로필 페이지 og:image 메타에서 추출 (모바일 UA)
 *   - youtube / tiktok: unavatar.io 프록시
 *
 * Vercel Edge Cache로 24h 브라우저 / 7d CDN 캐시.
 * 실패 시 404 → 카드에서 onError로 그라디언트 이니셜 fallback.
 */
import { NextRequest } from "next/server";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function resolveInstagramAvatar(handle: string): Promise<string | null> {
  const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  const res = await fetch(url, {
    headers: { "User-Agent": MOBILE_UA, "Accept-Language": "en-US,en;q=0.9" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();
  // og:image (또는 og:image:secure_url) 둘 다 시도
  const match =
    html.match(
      /<meta\s+property=["']og:image(?::secure_url)?["']\s+content=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<meta\s+content=["']([^"']+)["']\s+property=["']og:image(?::secure_url)?["']/i,
    );
  if (!match) return null;
  // HTML entity decode (& → &)
  return match[1].replace(/&amp;/g, "&").replace(/&#x2F;/g, "/");
}

function unavatarUrl(platform: "youtube" | "tiktok", handle: string): string {
  return `https://unavatar.io/${platform}/${encodeURIComponent(handle)}`;
}

export async function GET(req: NextRequest) {
  const platform = req.nextUrl.searchParams.get("platform");
  const rawHandle = req.nextUrl.searchParams.get("handle");

  if (!rawHandle) {
    return new Response("handle required", { status: 400 });
  }
  const handle = rawHandle.replace(/^@/, "").trim().toLowerCase();
  if (!handle) {
    return new Response("invalid handle", { status: 400 });
  }

  let imgUrl: string | null = null;
  try {
    if (platform === "instagram") {
      imgUrl = await resolveInstagramAvatar(handle);
    } else if (platform === "youtube" || platform === "tiktok") {
      imgUrl = unavatarUrl(platform, handle);
    } else {
      return new Response("unsupported platform", { status: 400 });
    }
  } catch {
    return new Response("resolve failed", { status: 502 });
  }

  if (!imgUrl) {
    return new Response("not found", { status: 404 });
  }

  // 이미지 다운로드 후 프록시
  const imgRes = await fetch(imgUrl, {
    headers: { "User-Agent": MOBILE_UA },
    redirect: "follow",
  });
  if (!imgRes.ok) {
    return new Response("image fetch failed", { status: imgRes.status });
  }

  const contentType = imgRes.headers.get("Content-Type") || "image/jpeg";
  const buf = await imgRes.arrayBuffer();

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // 브라우저 1일, Vercel Edge CDN 7일
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}
