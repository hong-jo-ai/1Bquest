/**
 * 알바 출근 → 주차 자동등록 크론. 근무일(월·화·목·금) 15:00 KST에 호출.
 * 오늘 박자영이 출근(근무 기록)이면 차량(ALBA.car)으로 주차 2시간 할인 등록 요청 적재
 * → 아이맥 triggerWatcher가 실제 등록 후 텔레그램 "완료" 회신.
 * ?force=1 이면 근무여부 무시하고 강제 요청(테스트용).
 */
import { workedToday, ALBA } from "@/lib/alba/attendance";
import { storeParkingRequest } from "@/lib/parking/request";

export const dynamic = "force-dynamic";

async function tg(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = new URL(req.url).searchParams.get("force");
  try {
    if (!ALBA.car) return Response.json({ ok: true, skipped: "차량번호 미설정" });
    const worked = force ? true : await workedToday();
    if (!worked) return Response.json({ ok: true, skipped: "오늘 미출근/근무일 아님" });
    await storeParkingRequest(ALBA.car);
    await tg(`🅿️ ${ALBA.name}님 출근 확인 → 차량 ${ALBA.car} 2시간 주차할인 자동등록 중...`);
    return Response.json({ ok: true, requested: ALBA.car });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) { return GET(req); }
