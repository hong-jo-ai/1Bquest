/**
 * 인플루언서 프로필 사진 프록시 (라이브 fallback).
 *
 * 클라이언트는 `/api/influencer/avatar?platform=instagram&handle=hong_sj` 같이 호출.
 * 해석 로직은 lib/influencer/avatarResolve(resolveAvatarUrl)와 공유 — 채우기 cron/백필과 동일.
 *
 * profileImage가 아직 영구 저장(Storage)되지 않은 인플루언서를 위한 즉석 프록시.
 * Vercel Edge Cache로 24h 브라우저 / 7d CDN 캐시. 실패 시 404 → 카드 이니셜 fallback.
 */
import { NextRequest } from "next/server";
import { resolveAvatarUrl } from "@/lib/influencer/avatarResolve";

// Edge runtime — Vercel serverless egress IP가 인스타에 차단되므로 Cloudflare 네트워크 사용
export const runtime = "edge";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

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
  if (platform !== "instagram" && platform !== "youtube" && platform !== "tiktok") {
    return new Response("unsupported platform", { status: 400 });
  }

  let imgUrl: string | null = null;
  try {
    imgUrl = await resolveAvatarUrl(platform, handle);
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
