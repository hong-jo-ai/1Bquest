import { notifyNewUnanswered, notifyStaleUnanswered } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";
// 스위퍼 2개(웹챗·AS)가 붙어 발송이 겹칠 수 있어 여유를 둔다.
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "new";

  // 웹챗 미통보 답변 스위퍼 — 고객이 탭을 강제종료해 away 신호가 안 온 케이스 회수.
  // 사장님 텔레그램 알림(아래)과 달리 고객 대상이라 주말에도 돌린다. mode=new(10분 주기)에서만.
  let webchatSweep: { checked: number; sent: number } | null = null;
  if (mode !== "stale") {
    try {
      const { sweepWebchatReplyNotifications } = await import("@/lib/cs/webchat");
      webchatSweep = await sweepWebchatReplyNotifications();
    } catch (e) {
      console.warn("[cs-notify] 웹챗 스위퍼 오류:", e instanceof Error ? e.message : String(e));
    }
  }

  // AS 발송완료 안내 **초안** 스위퍼 — 확인카드만 띄운다(발송은 사장님이 버튼을 눌러야 일어남).
  // shipped 로 바꾸는 경로가 둘(as-ship 라우트, 아이맥 asPaymentWatch)이라 라우트 훅만으론 샌다.
  let asSweep: { checked: number; prepared: number } | null = null;
  if (mode !== "stale") {
    try {
      const { sweepAsShippedNotifications } = await import("@/lib/cs/asShippedNotify");
      asSweep = await sweepAsShippedNotifications();
    } catch (e) {
      console.warn("[cs-notify] AS 발송안내 스위퍼 오류:", e instanceof Error ? e.message : String(e));
    }
  }

  // 주말(한국시간 토·일)에는 CS 알림을 보내지 않음 (사장님 요청).
  // notify 함수를 호출하지 않아 last_notify 워터마크가 전진하지 않음 →
  // 월요일 첫 실행 때 주말 동안 쌓인 미답변까지 한 번에 통지됨(알림 유실 없음).
  const kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay(); // 0=일,6=토 (KST 기준)
  if (kstDay === 0 || kstDay === 6) {
    return Response.json({ ok: true, mode, skipped: "weekend", sent: 0, webchatSweep, asSweep });
  }

  try {
    const result =
      mode === "stale" ? await notifyStaleUnanswered() : await notifyNewUnanswered();
    return Response.json({ ok: true, mode, ...result, webchatSweep, asSweep });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
