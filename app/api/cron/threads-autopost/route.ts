export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { dequeuePost, addPublishedPost, getPostQueue } from "@/lib/threadsScheduler";

const THREADS_BASE = "https://graph.threads.net/v1.0";

/**
 * 하루 4회 (KST 9:20, 12:40, 16:10, 20:50) 호출
 * 저장된 글 큐에서 랜덤 1개를 꺼내 Threads에 게시
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await getThreadsTokenFromStore();
  if (!token) {
    return NextResponse.json(
      { error: "Threads 토큰 없음 — 대시보드에서 Threads 로그인 필요" },
      { status: 401 }
    );
  }

  const post = await dequeuePost();
  if (!post) {
    return NextResponse.json({ success: true, message: "큐에 게시할 글 없음", queueSize: 0 });
  }

  try {
    // 사용자 ID 조회
    const meRes = await fetch(
      `${THREADS_BASE}/me?fields=id&access_token=${token}`,
      { cache: "no-store" }
    );
    if (!meRes.ok) throw new Error(`계정 조회 실패: ${await meRes.text()}`);
    const me = await meRes.json();

    // 컨테이너 생성
    const containerRes = await fetch(`${THREADS_BASE}/${me.id}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: token,
        media_type: "TEXT",
        text: post.text,
      }),
    });
    if (!containerRes.ok) throw new Error(`컨테이너 실패: ${await containerRes.text()}`);
    const container = await containerRes.json();

    // 게시
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

    // 게시 로그 저장
    await addPublishedPost({
      threadId: result.id,
      text: post.text,
      publishedAt: new Date().toISOString(),
      postId: post.id,
    });

    const remaining = (await getPostQueue()).length;
    console.log(`[Cron:threads-autopost] 게시 완료 threadId=${result.id}, 큐 잔여=${remaining}`);

    return NextResponse.json({
      success: true,
      threadId: result.id,
      text: post.text.slice(0, 50) + "...",
      queueRemaining: remaining,
    });
  } catch (e: any) {
    console.error("[Cron:threads-autopost]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
