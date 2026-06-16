/**
 * 알바 출퇴근 질문 크론 — 근무일(월·화·목·금, 공휴일 제외)에 텔레그램으로 "근무했나요? y/n" 발송.
 * Vercel 크론에서 호출(평일 15:10 KST = 06:10 UTC, 월/화/목/금). 공휴일 스킵은 라우트가 판단.
 */
import { askAttendance } from "@/lib/alba/attendance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await askAttendance();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) { return GET(req); }
