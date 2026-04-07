import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";

const THREADS_BASE = "https://graph.threads.net/v1.0";

/**
 * POST /api/threads/publish
 * Body: { text: string, mediaUrl?: string, mediaType?: "IMAGE" | "VIDEO" }
 *
 * Threads API 2단계 게시:
 * 1. 컨테이너 생성 (POST /{user_id}/threads)
 * 2. 게시 실행 (POST /{user_id}/threads_publish)
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("threads_at")?.value
    || await getThreadsTokenFromStore()
    || process.env.THREADS_ACCESS_TOKEN
    || null;

  if (!token) {
    return Response.json(
      { error: "Threads 계정 연결이 필요합니다." },
      { status: 401 }
    );
  }

  const { text, mediaUrl, mediaType } = await req.json();
  if (!text?.trim() && !mediaUrl) {
    return Response.json({ error: "게시할 텍스트 또는 미디어가 없습니다." }, { status: 400 });
  }

  try {
    // 0. Threads 사용자 ID 조회
    const meRes = await fetch(
      `${THREADS_BASE}/me?fields=id,username&access_token=${token}`,
      { cache: "no-store" }
    );
    if (!meRes.ok) {
      const err = await meRes.text();
      throw new Error(`Threads 계정 조회 실패: ${err}`);
    }
    const me = await meRes.json();
    const userId = me.id;

    // 1. 미디어 컨테이너 생성
    const containerParams: Record<string, string> = {
      access_token: token,
    };

    if (mediaUrl && mediaType === "IMAGE") {
      containerParams.media_type = "IMAGE";
      containerParams.image_url = mediaUrl;
      if (text?.trim()) containerParams.text = text.trim();
    } else if (mediaUrl && mediaType === "VIDEO") {
      containerParams.media_type = "VIDEO";
      containerParams.video_url = mediaUrl;
      if (text?.trim()) containerParams.text = text.trim();
    } else {
      containerParams.media_type = "TEXT";
      containerParams.text = text.trim();
    }

    const containerRes = await fetch(`${THREADS_BASE}/${userId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(containerParams),
    });
    if (!containerRes.ok) {
      const err = await containerRes.text();
      throw new Error(`컨테이너 생성 실패: ${err}`);
    }
    const container = await containerRes.json();
    const containerId = container.id;

    // 영상인 경우 처리 완료까지 대기 (최대 30초)
    if (mediaType === "VIDEO") {
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch(
          `${THREADS_BASE}/${containerId}?fields=status&access_token=${token}`,
          { cache: "no-store" }
        );
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData.status === "FINISHED") break;
          if (statusData.status === "ERROR") throw new Error("영상 처리 실패");
        }
      }
    }

    // 2. 게시 실행
    const publishRes = await fetch(`${THREADS_BASE}/${userId}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: token,
        creation_id: containerId,
      }),
    });
    if (!publishRes.ok) {
      const err = await publishRes.text();
      throw new Error(`게시 실패: ${err}`);
    }
    const result = await publishRes.json();

    return Response.json({
      success: true,
      threadId: result.id,
      username: me.username,
    });
  } catch (e: any) {
    console.error("[Threads publish]", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
