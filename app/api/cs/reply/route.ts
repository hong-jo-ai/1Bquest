import { sendReply } from "@/lib/cs/reply";

export const maxDuration = 60; // sixshop 등 큐 경유 채널은 워커 완료까지 동기 대기
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { threadId, body, attachments } = (await req.json()) as {
    threadId?: string;
    body?: string;
    attachments?: Array<{ url?: unknown; name?: unknown; isImage?: unknown }>;
  };
  if (!threadId || !body) {
    return Response.json(
      { ok: false, error: "threadId, body required" },
      { status: 400 }
    );
  }
  // 첨부는 우리 업로드 라우트가 준 https URL 만 통과시킨다(임의 URL 주입 방지).
  const safeAttachments = (Array.isArray(attachments) ? attachments : [])
    .flatMap((a) => {
      const url = typeof a?.url === "string" ? a.url : "";
      if (!/^https:\/\//i.test(url)) return [];
      return [{
        url,
        name: typeof a?.name === "string" ? a.name : undefined,
        isImage: a?.isImage === true,
      }];
    })
    .slice(0, 5); // 한 답장에 5장까지

  const result = await sendReply(threadId, body, {
    ...(safeAttachments.length ? { attachments: safeAttachments } : {}),
  });
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
