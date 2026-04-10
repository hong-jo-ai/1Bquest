export const maxDuration = 45;

import { NextRequest, NextResponse } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { dequeuePost, dequeuePostByBrand, addPublishedPost, getPostQueue, shouldPostNow } from "@/lib/threadsScheduler";
import type { BrandId } from "@/lib/threadsBrands";

const THREADS_BASE = "https://graph.threads.net/v1.0";

/**
 * 매시간 호출 — 설정된 하루 게시 횟수에 따라 게시 여부를 자동 판단
 * 큐에서 1개를 꺼내 해당 브랜드의 Threads 계정에 게시
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const targetBrand = (request.nextUrl.searchParams.get("brand") ?? "") as BrandId;

  // 설정에 따라 지금 게시할 시간인지 확인
  if (targetBrand) {
    const currentHourUTC = new Date().getUTCHours();
    const should = await shouldPostNow(targetBrand, currentHourUTC);
    if (!should) {
      return NextResponse.json({
        success: true,
        message: `${targetBrand}: 이 시간대에는 게시 안 함 (설정 기반)`,
        skipped: true,
      });
    }
  }

  const post = targetBrand
    ? await dequeuePostByBrand(targetBrand)
    : await dequeuePost();
  if (!post) {
    return NextResponse.json({ success: true, message: `큐에 게시할 글 없음 (${targetBrand || "전체"})`, queueSize: 0 });
  }

  const brand = post.brand ?? "paulvice";
  const token = await getThreadsTokenFromStore(brand);
  if (!token) {
    return NextResponse.json(
      { error: `${brand} Threads 토큰 없음 — 대시보드에서 해당 브랜드 Threads 로그인 필요` },
      { status: 401 }
    );
  }

  try {
    const meRes = await fetch(
      `${THREADS_BASE}/me?fields=id&access_token=${token}`,
      { cache: "no-store" }
    );
    if (!meRes.ok) throw new Error(`계정 조회 실패: ${await meRes.text()}`);
    const me = await meRes.json();

    const containerParams: Record<string, string> = { access_token: token };
    if (post.mediaUrl && post.mediaType === "IMAGE") {
      containerParams.media_type = "IMAGE";
      containerParams.image_url = post.mediaUrl;
      if (post.text) containerParams.text = post.text;
    } else if (post.mediaUrl && post.mediaType === "VIDEO") {
      containerParams.media_type = "VIDEO";
      containerParams.video_url = post.mediaUrl;
      if (post.text) containerParams.text = post.text;
    } else {
      containerParams.media_type = "TEXT";
      containerParams.text = post.text;
    }

    const containerRes = await fetch(`${THREADS_BASE}/${me.id}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(containerParams),
    });
    if (!containerRes.ok) throw new Error(`컨테이너 실패: ${await containerRes.text()}`);
    const container = await containerRes.json();

    // 영상 처리 대기
    if (post.mediaType === "VIDEO") {
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const sRes = await fetch(`${THREADS_BASE}/${container.id}?fields=status&access_token=${token}`, { cache: "no-store" });
        if (sRes.ok) {
          const s = await sRes.json();
          if (s.status === "FINISHED") break;
          if (s.status === "ERROR") throw new Error("영상 처리 실패");
        }
      }
    }

    const publishRes = await fetch(`${THREADS_BASE}/${me.id}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: token,
        creation_id: container.id,
      }),
    });
    if (!publishRes.ok) throw new Error(`게시 실패: ${await publishRes.text()}`);
    const result = await publishRes.json();

    await addPublishedPost({
      threadId: result.id,
      text: post.text,
      publishedAt: new Date().toISOString(),
      postId: post.id,
      brand,
    });

    const remaining = (await getPostQueue()).length;
    console.log(`[Cron:threads-autopost] ${brand} 게시 완료 threadId=${result.id}, 큐 잔여=${remaining}`);

    return NextResponse.json({
      success: true,
      brand,
      threadId: result.id,
      text: post.text.slice(0, 50) + "...",
      queueRemaining: remaining,
    });
  } catch (e: any) {
    console.error(`[Cron:threads-autopost] ${brand}`, e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
