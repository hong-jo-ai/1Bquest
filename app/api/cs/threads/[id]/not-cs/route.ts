import { getThread, setThreadStatus } from "@/lib/cs/store";
import { addToSenderBlacklist } from "@/lib/cs/classifier";

export const dynamic = "force-dynamic";

/**
 * POST /api/cs/threads/{id}/not-cs
 * 이 스레드를 archived로 전환.
 * ?blockSender=1 을 붙이면 송신자도 차단 목록에 추가 (선택).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const blockSender = url.searchParams.get("blockSender") === "1";

  try {
    const data = await getThread(id);
    if (!data) {
      return Response.json({ error: "thread not found" }, { status: 404 });
    }

    let added: string | null = null;
    if (blockSender) {
      const handle = data.thread.customer_handle;
      if (handle && handle.includes("@")) {
        const domain = "@" + handle.split("@")[1].toLowerCase();
        const isPersonalDomain = [
          "@gmail.com",
          "@naver.com",
          "@daum.net",
          "@kakao.com",
          "@hanmail.net",
          "@nate.com",
          "@hotmail.com",
          "@outlook.com",
          "@yahoo.com",
          "@yahoo.co.kr",
        ].includes(domain);
        added = isPersonalDomain ? handle.toLowerCase() : domain;
        await addToSenderBlacklist(added);
      }
    }

    await setThreadStatus(id, "archived");
    return Response.json({ ok: true, blacklisted: added });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
