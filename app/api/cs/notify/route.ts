import { notifyNewUnanswered, notifyStaleUnanswered } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  // 주말(한국시간 토·일)에는 CS 알림을 보내지 않음 (사장님 요청).
  // notify 함수를 호출하지 않아 last_notify 워터마크가 전진하지 않음 →
  // 월요일 첫 실행 때 주말 동안 쌓인 미답변까지 한 번에 통지됨(알림 유실 없음).
  const kstDay = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay(); // 0=일,6=토 (KST 기준)
  if (kstDay === 0 || kstDay === 6) {
    return Response.json({ ok: true, mode, skipped: "weekend", sent: 0 });
  }

  try {
    const result =
      mode === "stale" ? await notifyStaleUnanswered() : await notifyNewUnanswered();
    return Response.json({ ok: true, mode, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
