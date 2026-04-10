import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import type { BrandId } from "@/lib/threadsBrands";

const THREADS_BASE = "https://graph.threads.net/v1.0";

/**
 * POST /api/threads/comments/reply
 * Body: { commentId: string, text: string, brand: BrandId }
 *
 * 특정 댓글에 대댓글 게시
 */
export async function POST(req: NextRequest) {
  const { commentId, text, brand = "paulvice" } = await req.json();
  const b = brand as BrandId;

  if (!commentId || !text?.trim()) {
    return Response.json({ error: "commentId와 text가 필요합니다" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const token =
    cookieStore.get(`threads_at_${b}`)?.value ||
    (await getThreadsTokenFromStore(b)) ||
    null;

  if (!token) {
    return Response.json({ error: "Threads 미연결" }, { status: 401 });
  }

  try {
    // 사용자 ID 조회
    const meRes = await fetch(
      `${THREADS_BASE}/me?fields=id&access_token=${token}`,
      { cache: "no-store" },
    );
    if (!meRes.ok) throw new Error("계정 조회 실패");
    const me = await meRes.json();
    const userId = me.id;

    // 대댓글 미디어 컨테이너 생성 (reply_to_id 사용)
    const containerRes = await fetch(`${THREADS_BASE}/${userId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: token,
        media_type: "TEXT",
        text: text.trim(),
        reply_to_id: commentId,
      }),
    });

    if (!containerRes.ok) {
      const err = await containerRes.text();
      throw new Error(`대댓글 컨테이너 생성 실패: ${err}`);
    }
    const container = await containerRes.json();

    // 컨테이너 처리 대기
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const statusRes = await fetch(
        `${THREADS_BASE}/${container.id}?fields=status&access_token=${token}`,
        { cache: "no-store" },
      );
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.status === "FINISHED") break;
        if (statusData.status === "ERROR") throw new Error("대댓글 처리 실패");
      }
    }

    // 게시 실행
    const publishRes = await fetch(`${THREADS_BASE}/${userId}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: token,
        creation_id: container.id,
      }),
    });

    if (!publishRes.ok) {
      const err = await publishRes.text();
      throw new Error(`대댓글 게시 실패: ${err}`);
    }

    const result = await publishRes.json();
    return Response.json({ success: true, replyId: result.id });
  } catch (e: any) {
    console.error("[Comment reply]", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
