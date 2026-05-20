import { getThread, setThreadStatus } from "@/lib/cs/store";
import {
  addToSenderBlacklist,
  addClassifierNegative,
  type ClassifierNegative,
} from "@/lib/cs/classifier";

export const dynamic = "force-dynamic";

const PERSONAL_EMAIL_DOMAINS = [
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
];

/**
 * POST /api/cs/threads/{id}/not-cs
 * 이 스레드를 archived로 전환 + 분류기 학습.
 *
 * 차단 정책 (사용자 선택: "회사 도메인만 자동 차단"):
 *   - 항상 분류기 negative 학습 (`cs_classifier_negatives`) → 비슷한 메일 AI 자동 거름.
 *   - 발신자가 회사 도메인(비개인)이면 도메인 자동 하드 차단 → 같은 도메인 재유입 방지.
 *   - 개인 메일(gmail/naver 등)은 학습만. ?blockSender=1 일 때만 그 정확 주소까지 하드 차단.
 *     (실제 고객이 한 번 비-CS 보냈다고 영구 차단되는 사고 방지)
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
    const handle = data.thread.customer_handle;
    if (handle && handle.includes("@")) {
      const domain = "@" + handle.split("@")[1].toLowerCase();
      const isPersonal = PERSONAL_EMAIL_DOMAINS.includes(domain);
      if (!isPersonal) {
        // 회사 도메인 → 항상 도메인 자동 차단
        added = domain;
        await addToSenderBlacklist(domain);
      } else if (blockSender) {
        // 개인 메일은 명시적 차단 요청일 때만 정확 주소 차단
        added = handle.toLowerCase();
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
