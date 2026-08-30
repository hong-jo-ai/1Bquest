/**
 * 팝업 안전장치 — 팝업이 오히려 구매를 방해하면 자동으로 끈다.
 *
 * 2026-07-08 웰컴팝업 사고 때는 주문 급락을 며칠 지나서야 알아챘다. 그동안 매출이 샜다.
 * 이번엔 홀드아웃(안 띄운 사람들)의 구매율과 매일 비교해, 팝업군이 유의하게 낮으면
 * 사람을 기다리지 않고 즉시 끈 뒤 알린다. **끄는 건 되돌리기 쉽고, 놔두는 건 비싸다.**
 *
 * 표본이 작을 땐 아무 판단도 하지 않는다 — 몇 건 차이로 껐다 켰다 하면 그게 더 해롭다.
 */
import { withCron } from "@/lib/cron/withCron";
import { popupStats, setConfig } from "@/lib/storefront/popup";
import { sendTelegramMessage } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 이보다 표본이 적으면 비교하지 않는다. */
const MIN_SAMPLE = 40;
/** 팝업군 구매율이 홀드아웃보다 이만큼(%p) 낮으면 끈다. */
const HARM_THRESHOLD = 0.03;

async function run(): Promise<Response> {
  const s = await popupStats(14);
  if (!s) throw new Error("팝업 통계 조회 실패");

  if (!s.enabled) return Response.json({ ok: true, note: "이미 꺼져 있음", stats: s });
  if (s.shown < MIN_SAMPLE || s.holdoutSize < 20 || s.liftPp === null) {
    return Response.json({ ok: true, note: "표본 부족 — 판단 보류", stats: s });
  }

  if (s.liftPp <= -HARM_THRESHOLD) {
    await setConfig({ enabled: false });
    await sendTelegramMessage(
      `🔴 <b>망설임 팝업 자동 중단</b>\n`
      + `팝업 본 사람 구매율 ${(s.shownCvr * 100).toFixed(1)}% vs 안 본 사람 ${(s.holdoutCvr * 100).toFixed(1)}%\n`
      + `(${s.shown}명 / 홀드아웃 ${s.holdoutSize}명, 최근 14일)\n`
      + `방해가 되고 있어 껐습니다. 2026-07-08 웰컴팝업과 같은 양상입니다.`,
    ).catch(() => {});
    return Response.json({ ok: true, disabled: true, stats: s });
  }
  return Response.json({ ok: true, stats: s });
}

export const GET = withCron("popup-guard", run);
