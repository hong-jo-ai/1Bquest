import { getCsSupabase, getThread, setThreadStatus } from "@/lib/cs/store";
import { addToSenderBlacklist } from "@/lib/cs/classifier";

export const dynamic = "force-dynamic";

/**
 * POST /api/cs/threads/{id}/not-cs
 * 이 스레드를 CS가 아닌 것으로 표시:
 *   1. 송신자(이메일 또는 도메인)를 학습 차단 목록에 추가
 *   2. 스레드를 archived로 전환
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const data = await getThread(id);
    if (!data) {
      return Response.json({ error: "thread not found" }, { status: 404 });
    }

    const handle = data.thread.customer_handle;
    let added: string | null = null;
    if (handle && handle.includes("@")) {
      // 이메일이면 도메인 단위로 차단 (개인 gmail/naver는 정확 매칭, 회사 도메인은 도메인)
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

    await setThreadStatus(id, "archived");
    return Response.json({ ok: true, blacklisted: added });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
