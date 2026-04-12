import { sendReply } from "@/lib/cs/reply";

export const maxDuration = 30;
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
