import { type NextRequest } from "next/server";
import { getPostQueue, savePostQueue, type QueuedPost } from "@/lib/threadsScheduler";

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
  const { id, text, brand = "paulvice" } = await req.json();
  if (!id || !text?.trim()) {
    return Response.json({ error: "id와 text 필요" }, { status: 400 });
  }

  const queue = await getPostQueue();
  if (queue.some((p) => p.id === id)) {
    return Response.json({ error: "이미 큐에 있습니다" }, { status: 409 });
  }

  queue.push({ id, text: text.trim(), brand });
  await savePostQueue(queue);
  return Response.json({ ok: true, count: queue.length });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return Response.json({ error: "id 필요" }, { status: 400 });

  const queue = await getPostQueue();
  const filtered = queue.filter((p) => p.id !== id);
  await savePostQueue(filtered);
  return Response.json({ ok: true, count: filtered.length });
}
