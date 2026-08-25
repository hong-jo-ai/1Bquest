/**
 * 알바 출퇴근 무응답 리마인드 크론.
 *
 * 답을 안 하면 근무로 기록되는 구조라, 미확인이 쌓이면 급여가 그대로 과다 계상된다.
 * (2026-07~08 에 실제로 5일이 무응답으로 근무 처리돼 있었다 — 7/16·7/27·7/31·8/6·8/19)
 *
 * 매 근무일 아침, 지난 근무일 중 미확인이 있으면 가장 오래된 하나를 다시 묻는다.
 * 크론: 평일 09:00 KST (= 00:00 UTC)
 */
import { remindUnconfirmed } from "@/lib/alba/attendance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await remindUnconfirmed();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) { return GET(req); }
