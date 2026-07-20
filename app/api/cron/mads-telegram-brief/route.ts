/**
 * MADS 아침 텔레그램 브리핑 — 매일 KST 09:35 (mads-evaluate 09:00 수집 후).
 * 어제 계정별 지출/매출/ROAS + 이상신호 + 대기 추천 요약을 텔레그램으로.
 */
import { sendMadsTelegramBrief } from "@/lib/mads/telegramBrief";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function cronMain() {
  try {
    const result = await sendMadsTelegramBrief();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const GET = withCron("mads-telegram-brief", () => cronMain());
export const POST = () => cronMain();
