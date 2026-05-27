/**
 * 인플루언서 프로필 사진 해석 + 영구 저장 엔진.
 *
 * 두 가지를 한다:
 *  1) resolveAvatarUrl: platform+handle → 원본 사진 URL(인스타 비공식 API/og:image, 유튜브·틱톡 unavatar).
 *  2) captureAvatarToStorage: 위 URL의 바이트를 받아 Supabase Storage(public 버킷)에 올리고
 *     **영구 public URL**을 돌려준다 → 이걸 influencer.profileImage에 박으면 라이브 인스타 의존이 사라진다.
 *
 * ⚠️ 인스타 해석은 Vercel serverless egress IP가 차단되므로 **edge 런타임 또는 주거용 IP**에서만 동작.
 *   (그래서 /api/influencer/avatar 와 채우기 cron 은 edge, 최초 백필은 로컬에서 돈다.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const AVATAR_BUCKET = "influencer-avatars";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export type AvatarPlatform = "instagram" | "youtube" | "tiktok";

async function resolveInstagramAvatar(handle: string): Promise<string | null> {
  // 1차: 비공식 web_profile_info API (JSON, 안정적)
  try {
    const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`;
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": MOBILE_UA,
        "x-ig-app-id": "936619743392459",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { user?: { profile_pic_url_hd?: string; profile_pic_url?: string } };
      };
      const pic = json?.data?.user?.profile_pic_url_hd || json?.data?.user?.profile_pic_url;
      if (pic) return pic;
    }
  } catch {
    /* fall through to og:image */
  }

  // 2차: 프로필 페이지 HTML에서 og:image
  try {
    const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": MOBILE_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(/<meta\s+property=["']og:image(?::secure_url)?["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image(?::secure_url)?["']/i);
    if (!match) return null;
    return match[1].replace(/&amp;/g, "&").replace(/&#x2F;/g, "/");
  } catch {
    return null;
  }
}

/** platform+handle → 원본 사진 URL(없으면 null). */
export async function resolveAvatarUrl(platform: string, handle: string): Promise<string | null> {
  const h = handle.replace(/^@/, "").trim().toLowerCase();
  if (!h) return null;
  if (platform === "instagram") return resolveInstagramAvatar(h);
  if (platform === "youtube" || platform === "tiktok") {
    // unavatar가 못 찾으면 404 → 아래 바이트 fetch에서 걸러짐
    return `https://unavatar.io/${platform}/${encodeURIComponent(h)}?fallback=false`;
  }
  return null;
}

/** 핸들을 storage object 경로로 안전하게. */
function safeKey(platform: string, handle: string): string {
  const h = handle.replace(/^@/, "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return `${platform}/${h}.jpg`;
}

let bucketEnsured = false;
async function ensureBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketEnsured) return;
  const { data: buckets } = await supabase.storage.listBuckets();
  const existing = buckets?.find((b) => b.name === AVATAR_BUCKET);
  if (!existing) {
    await supabase.storage.createBucket(AVATAR_BUCKET, { public: true });
  } else if (!existing.public) {
    await supabase.storage.updateBucket(AVATAR_BUCKET, { public: true });
  }
  bucketEnsured = true;
}

/**
 * platform+handle 사진을 받아 Storage에 올리고 영구 public URL 반환.
 * 해석 실패/다운로드 실패면 null(호출 측이 건너뛰고 빈 채로 둠 → 라이브 프록시 fallback).
 */
export async function captureAvatarToStorage(
  supabase: SupabaseClient,
  platform: string,
  handle: string,
): Promise<string | null> {
  const srcUrl = await resolveAvatarUrl(platform, handle);
  if (!srcUrl) return null;

  let bytes: ArrayBuffer;
  let contentType = "image/jpeg";
  try {
    const res = await fetch(srcUrl, { headers: { "User-Agent": MOBILE_UA }, redirect: "follow" });
    if (!res.ok) return null;
    contentType = res.headers.get("Content-Type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    bytes = await res.arrayBuffer();
    if (bytes.byteLength < 256) return null; // 빈/에러 응답 방어
  } catch {
    return null;
  }

  try {
    await ensureBucket(supabase);
    const path = safeKey(platform, handle);
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return data.publicUrl || null;
  } catch {
    return null;
  }
}
