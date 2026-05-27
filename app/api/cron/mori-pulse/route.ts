/**
 * 모리 능동 발화 — 자리비움(away) 경로.
 *
 * /mori 화면이 열려 있으면 클라이언트 폴(120s)이 펄스를 돌려 화면에 띄운다.
 * 화면을 안 보고 있을 때(자리비움)는 이 cron이 대신 펄스를 돌리고, 새로 생긴
 * 능동 발화를 **텔레그램으로 밀어준다** — "먼저 말 거는" 비서의 물리적 전제.
 *
 * 흐름: 인증 → runPulse(신호 감지·생성·적재) → isAway면 큐를 비워 텔레그램 push,
 *       화면 앞이면 큐를 남겨 화면이 띄우게 둔다.
 *
 * 권장 스케줄(vercel.json): 30분마다. 사무시간/조용모드 게이트는 펄스 내부가 처리.
 */

import { NextRequest, NextResponse } from "next/server";
import { runPulse, drainQueue } from "@/lib/mori/pulse";
import { isAway } from "@/lib/mori/presence";
import { sendTelegramMessage } from "@/lib/cs/telegram";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** sendTelegramMessage가 parse_mode=HTML이라 발화 텍스트를 이스케이프. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await runPulse(); // 신호 있으면 생성·큐 적재(없으면 저렴하게 종료)

    const away = await isAway();
    if (!away) {
      // 화면 앞 — 화면(클라 폴)이 큐를 띄운다. 텔레그램 중복 방지로 손대지 않음.
      return NextResponse.json({ ok: true, away: false, pushed: 0 });
    }

    // 자리비움 — 대기 중 발화 전부를 텔레그램으로 밀고 큐를 비운다.
    const utterances = await drainQueue();
    let pushed = 0;
    for (const u of utterances) {
      const tag = u.urgent ? "🔔 모리(긴급)" : "🤖 모리";
      try {
        await sendTelegramMessage(`<b>${tag}</b>\n\n${escapeHtml(u.text)}`);
        pushed++;
      } catch {
        /* 한 건 실패해도 나머지는 계속 */
      }
    }
    return NextResponse.json({ ok: true, away: true, pushed, queued: utterances.length });
  } catch (e: any) {
    console.error("[Cron:mori-pulse] 실패:", e);
    return NextResponse.json({ error: e?.message ?? "mori-pulse 오류" }, { status: 500 });
  }
}
