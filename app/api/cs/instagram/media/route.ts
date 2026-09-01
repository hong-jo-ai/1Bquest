/**
 * 인스타 게시물 썸네일 프록시 — 댓글이 **어느 글에 달렸는지** 인박스에서 바로 보이게 한다.
 *
 * 왜 프록시인가: Graph 가 주는 media_url/thumbnail_url 은 **서명된 CDN 링크라 몇 시간이면 만료**된다.
 * 적재 시점에 DB 에 넣어두면 하루만 지나도 깨진 이미지가 된다 → 볼 때마다 새로 받아 리다이렉트한다.
 *
 * GET /api/cs/instagram/media?id=<mediaId>&brand=paulvice|harriot
 *   → 302 로 현재 유효한 이미지 URL 로 보낸다.
 */
import { listIgAccounts, refreshIgLoginTokenIfNeeded } from "@/lib/cs/instagramClient";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const IG_BASE = "https://graph.instagram.com/v22.0";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  const brand = sp.get("brand") === "harriot" ? "harriot" : "paulvice";
  if (!id || !/^\d+$/.test(id)) {
    return Response.json({ error: "media id 필요" }, { status: 400 });
  }

  try {
    const accounts = await listIgAccounts();
    let account = accounts.find((a) => a.brand === brand && a.igLoginToken);
    if (!account) return Response.json({ error: "IG 계정 없음" }, { status: 404 });
    account = await refreshIgLoginTokenIfNeeded(account);

    const url =
      `${IG_BASE}/${id}?fields=media_type,media_url,thumbnail_url` +
      `&access_token=${encodeURIComponent(account.igLoginToken!)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return Response.json({ error: "조회 실패" }, { status: 502 });
    const json = (await res.json()) as {
      media_type?: string;
      media_url?: string;
      thumbnail_url?: string;
    };
    // 동영상/릴스는 media_url 이 mp4 라 thumbnail_url 이 맞다.
    const src = json.thumbnail_url ?? json.media_url;
    if (!src) return Response.json({ error: "이미지 없음" }, { status: 404 });

    return new Response(null, {
      status: 302,
      headers: {
        Location: src,
        // 서명 URL 수명보다 짧게만 캐시 — 만료된 링크를 계속 물고 있으면 안 된다.
        "Cache-Control": "private, max-age=1800",
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
