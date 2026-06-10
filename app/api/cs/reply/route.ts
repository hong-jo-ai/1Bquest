import { sendReply } from "@/lib/cs/reply";

export const maxDuration = 60; // sixshop 등 큐 경유 채널은 워커 완료까지 동기 대기
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { threadId, body } = (await req.json()) as {
    threadId?: string;
    body?: string;
  };
  if (!threadId || !body) {
    return Response.json(
      { ok: false, error: "threadId, body required" },
      { status: 400 }
    );
  }
  const result = await sendReply(threadId, body);
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
