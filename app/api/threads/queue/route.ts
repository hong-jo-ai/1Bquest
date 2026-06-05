import { type NextRequest } from "next/server";
import { getPostQueue, savePostQueue, type QueuedPost } from "@/lib/threadsScheduler";

const THREADS_TEXT_LIMIT = 500;

function countChars(text: string): number {
  return [...text].length;
}

/**
 * GET  /api/threads/queue — 현재 큐 조회
 * POST /api/threads/queue — 글 추가 { id, text }
 * DELETE /api/threads/queue — 글 제거 { id }
 */
export async function GET() {
  const queue = await getPostQueue();
  return Response.json({ queue, count: queue.length });
}

export async function POST(req: NextRequest) {
  const { id, text, brand = "paulvice", mediaUrl, mediaType, scheduledAt } = await req.json();
  if (!id || !text?.trim()) {
    return Response.json({ error: "id와 text 필요" }, { status: 400 });
  }
  const trimmedText = text.trim();
  const charCount = countChars(trimmedText);
  if (charCount > THREADS_TEXT_LIMIT) {
    return Response.json(
      { error: `Threads 글은 ${THREADS_TEXT_LIMIT}자 이하여야 합니다. 현재 ${charCount}자입니다.` },
      { status: 400 }
    );
  }

  const queue = await getPostQueue();
  if (queue.some((p) => p.id === id)) {
    return Response.json({ error: "이미 큐에 있습니다" }, { status: 409 });
  }

  const post: QueuedPost = { id, text: trimmedText, brand, mediaUrl, mediaType };
  if (scheduledAt) post.scheduledAt = scheduledAt;
  queue.push(post);
  await savePostQueue(queue);
  return Response.json({ ok: true, count: queue.length });
}

/**
 * PUT /api/threads/queue — 대기/예약 글 수정 (patch).
 * 보낸 필드만 갱신:
 *   text        : 본문 교체 (빈 값 불가)
 *   scheduledAt : 예약 시각(ISO) 변경. null/"" 이면 예약 해제 → 자동게시 큐로 전환
 *   mediaUrl/mediaType : 첨부 미디어 변경. null 이면 제거
 */
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id } = body;
  if (!id) return Response.json({ error: "id 필요" }, { status: 400 });

  const queue = await getPostQueue();
  const post = queue.find((p) => p.id === id);
  if (!post) return Response.json({ error: "큐에 없음" }, { status: 404 });

  if ("text" in body) {
    const trimmedText = body.text?.trim();
    if (!trimmedText) {
      return Response.json({ error: "text는 비울 수 없습니다" }, { status: 400 });
    }
    const charCount = countChars(trimmedText);
    if (charCount > THREADS_TEXT_LIMIT) {
      return Response.json(
        { error: `Threads 글은 ${THREADS_TEXT_LIMIT}자 이하여야 합니다. 현재 ${charCount}자입니다.` },
        { status: 400 }
      );
    }
    post.text = trimmedText;
  }
  if ("scheduledAt" in body) {
    if (body.scheduledAt) post.scheduledAt = body.scheduledAt;
    else delete post.scheduledAt; // 예약 해제 → 자동게시
  }
  if ("mediaUrl" in body) {
    post.mediaUrl = body.mediaUrl ?? undefined;
    post.mediaType = body.mediaType ?? undefined;
  }

  await savePostQueue(queue);
  return Response.json({ ok: true, post });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return Response.json({ error: "id 필요" }, { status: 400 });

  const queue = await getPostQueue();
  const filtered = queue.filter((p) => p.id !== id);
  await savePostQueue(filtered);
  return Response.json({ ok: true, count: filtered.length });
}
