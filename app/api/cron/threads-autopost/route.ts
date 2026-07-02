export const maxDuration = 45;

import { NextResponse } from "next/server";
import { getThreadsTokenFromStore, refreshThreadsTokenIfNeeded } from "@/lib/threadsTokenStore";
import {
  dequeueAutoPostByBrand,
  dequeuePost,
  dequeueScheduledPostByBrand,
  addPublishedPost,
  getPostQueue,
  savePostQueue,
  shouldPostNow,
  type QueuedPost,
} from "@/lib/threadsScheduler";
import type { BrandId } from "@/lib/threadsBrands";
import { withCron } from "@/lib/cron/withCron";

const THREADS_BASE = "https://graph.threads.net/v1.0";
const THREADS_TEXT_LIMIT = 500;

async function restoreDequeuedPost(post: QueuedPost): Promise<number> {
  const queue = await getPostQueue();
  if (!queue.some((p) => p.id === post.id)) {
    queue.push(post);
    await savePostQueue(queue);
  }
  return queue.length;
}

/**
 * 매시간 호출 — 설정된 하루 게시 횟수에 따라 게시 여부를 자동 판단
 * 큐에서 1개를 꺼내 해당 브랜드의 Threads 계정에 게시
 */
async function cronMain(request: Request) {

  const targetBrand = (new URL(request.url).searchParams.get("brand") ?? "") as BrandId;

  // 장기토큰 자동연장(7일 주기) — 만료 사고 재발 방지. 게시 여부와 무관하게 매 크론마다 체크.
  if (targetBrand) await refreshThreadsTokenIfNeeded(targetBrand);

  const scheduledPost = targetBrand
    ? await dequeueScheduledPostByBrand(targetBrand)
    : null;

  // 예약 게시가 없을 때만 자동게시 설정에 따라 지금 게시할 시간인지 확인
  if (targetBrand) {
    if (!scheduledPost && !(await shouldPostNow(targetBrand, new Date().getUTCHours()))) {
      return NextResponse.json({
        success: true,
        message: `${targetBrand}: 예약 글 없음, 자동게시 시간대 아님 (설정 기반)`,
        skipped: true,
      });
    }
  }

  const post = scheduledPost ?? (targetBrand
    ? await dequeueAutoPostByBrand(targetBrand)
    : await dequeuePost());
  if (!post) {
    return NextResponse.json({ success: true, message: `큐에 게시할 글 없음 (${targetBrand || "전체"})`, queueSize: 0 });
  }

  const brand = post.brand ?? "paulvice";
  if ([...post.text].length > THREADS_TEXT_LIMIT) {
    const restoredCount = await restoreDequeuedPost(post);
    return NextResponse.json(
      {
        error: `Threads 글은 ${THREADS_TEXT_LIMIT}자 이하여야 합니다. 현재 ${[...post.text].length}자입니다.`,
        restored: true,
        queueSize: restoredCount,
      },
      { status: 400 }
    );
  }

  const token = await getThreadsTokenFromStore(brand);
  if (!token) {
    const restoredCount = await restoreDequeuedPost(post);
    return NextResponse.json(
      {
        error: `${brand} Threads 토큰 없음 — 대시보드에서 해당 브랜드 Threads 로그인 필요`,
        restored: true,
        queueSize: restoredCount,
      },
      { status: 401 }
    );
  }

  let publishedThreadId: string | null = null;
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
    const threadId = String(result.id);
    publishedThreadId = threadId;

    await addPublishedPost({
      threadId,
      text: post.text,
      publishedAt: new Date().toISOString(),
      postId: post.id,
      brand,
      source: post.scheduledAt ? "scheduled" : "auto",
    });

    const remaining = (await getPostQueue()).length;
    console.log(`[Cron:threads-autopost] ${brand} 게시 완료 threadId=${threadId}, 큐 잔여=${remaining}`);

    return NextResponse.json({
      success: true,
      brand,
      threadId,
      text: post.text.slice(0, 50) + "...",
      queueRemaining: remaining,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Cron:threads-autopost] ${brand}`, e);
    if (publishedThreadId) {
      return NextResponse.json(
        { error: message, published: true, threadId: publishedThreadId, restored: false },
        { status: 500 }
      );
    }
    const restoredCount = await restoreDequeuedPost(post);
    return NextResponse.json({ error: message, restored: true, queueSize: restoredCount }, { status: 500 });
  }
}

export const GET = withCron("threads-autopost", (req) => cronMain(req));
