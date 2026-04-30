import { getThread, setThreadStatus } from "@/lib/cs/store";
import {
  addToSenderBlacklist,
  addClassifierNegative,
  type ClassifierNegative,
} from "@/lib/cs/classifier";

export const dynamic = "force-dynamic";

/**
 * POST /api/cs/threads/{id}/not-cs
 * 이 스레드를 archived로 전환.
 * ?blockSender=1 을 붙이면 송신자도 차단 목록에 추가 (선택).
 *
 * 추가로 — 사용자가 "CS 아님" 으로 마킹한 사례를 분류기 학습 셋
 * (`cs_classifier_negatives`) 에 추가해, 다음에 비슷한 메일이 들어오면
 * 분류기가 자동으로 false 로 거른다.
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

    // 분류기 학습 — 가장 최근 incoming 메시지를 negative example 로 기록
    try {
      const latestIncoming = [...data.messages]
        .reverse()
        .find((m) => m.direction === "in");
      if (latestIncoming) {
        const neg: ClassifierNegative = {
          brand:     data.thread.brand,
          fromEmail: data.thread.customer_handle ?? null,
          fromName:  data.thread.customer_name ?? null,
          subject:   data.thread.subject ?? "(제목 없음)",
          snippet:   (latestIncoming.body_text ?? data.thread.last_message_preview ?? "").slice(0, 400),
          ts:        new Date().toISOString(),
        };
        await addClassifierNegative(neg);
      }
    } catch (e) {
      // 학습 실패해도 archived 처리는 진행
      console.error("[not-cs] classifier negative 추가 실패:", e);
    }

    await setThreadStatus(id, "archived");
    return Response.json({ ok: true, blacklisted: added });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
