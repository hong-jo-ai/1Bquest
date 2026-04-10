import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import type { BrandId } from "@/lib/threadsBrands";

const THREADS_BASE = "https://graph.threads.net/v1.0";

export interface ThreadComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  hasReplied: boolean;
}

/**
 * GET /api/threads/comments?threadId=xxx&brand=paulvice
 * 특정 게시물의 댓글(답글) 목록 조회
 */
export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  const brand = (req.nextUrl.searchParams.get("brand") ?? "paulvice") as BrandId;

  if (!threadId) {
    return NextResponse.json({ error: "threadId 필요" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const token =
    cookieStore.get(`threads_at_${brand}`)?.value ||
    (await getThreadsTokenFromStore(brand)) ||
    null;

  if (!token) {
    return NextResponse.json({ error: "Threads 미연결" }, { status: 401 });
  }

  try {
    // 내 사용자 ID 조회 (내 답글 여부 확인용)
    const meRes = await fetch(
      `${THREADS_BASE}/me?fields=id,username&access_token=${token}`,
      { cache: "no-store" },
    );
    if (!meRes.ok) throw new Error("계정 조회 실패");
    const me = await meRes.json();
    const myUsername = me.username;

    // 게시물의 댓글 조회
    const repliesRes = await fetch(
      `${THREADS_BASE}/${threadId}/replies?fields=id,text,username,timestamp&access_token=${token}`,
      { cache: "no-store" },
    );

    if (!repliesRes.ok) {
      const err = await repliesRes.text();
      console.error("[Comments] 댓글 조회 실패:", err);
      return NextResponse.json({ error: "댓글 조회 실패" }, { status: repliesRes.status });
    }

    const repliesData = await repliesRes.json();
    const rawReplies: Array<{ id: string; text?: string; username?: string; timestamp?: string }> =
      repliesData.data ?? [];

    // 각 댓글에 대해 내가 이미 답글을 달았는지 확인
    const comments: ThreadComment[] = [];

    for (const reply of rawReplies) {
      // 내 자신의 답글은 목록에서 제외
      if (reply.username === myUsername) continue;

      let hasReplied = false;
      try {
        const subRes = await fetch(
          `${THREADS_BASE}/${reply.id}/replies?fields=id,username&access_token=${token}`,
          { cache: "no-store" },
        );
        if (subRes.ok) {
          const subData = await subRes.json();
          hasReplied = (subData.data ?? []).some(
            (r: { username?: string }) => r.username === myUsername,
          );
        }
      } catch {}

      comments.push({
        id: reply.id,
        text: reply.text ?? "",
        username: reply.username ?? "unknown",
        timestamp: reply.timestamp ?? new Date().toISOString(),
        hasReplied,
      });
    }

    return NextResponse.json({ comments });
  } catch (e: any) {
    console.error("[Comments]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
