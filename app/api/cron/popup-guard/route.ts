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
import { popupStats, disablePopup, type PopupStats } from "@/lib/storefront/popup";
import { sendTelegramMessage } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 이보다 표본이 적으면 비교하지 않는다. */
const MIN_SAMPLE = 40;
/** 팝업군 구매율이 홀드아웃보다 이만큼(%p) 낮으면 끈다. */
const HARM_THRESHOLD = 0.03;

const LABEL: Record<"hesitation" | "cart", string> = {
  hesitation: "망설임 팝업",
  cart: "장바구니 리마인더",
};

/** 팝업 하나를 평가하고, 해로우면 그것만 끈다. */
async function judge(kind: "hesitation" | "cart"): Promise<{ kind: string; note?: string; disabled?: boolean; stats: PopupStats | null }> {
  const s = await popupStats(14, kind);
  if (!s) return { kind, note: "통계 조회 실패", stats: null };

  if (!s.enabled) return { kind, note: "이미 꺼져 있음", stats: s };
  if (s.shown < MIN_SAMPLE || s.holdoutSize < 20 || s.liftPp === null) {
    return { kind, note: "표본 부족 — 판단 보류", stats: s };
  }

  if (s.liftPp <= -HARM_THRESHOLD) {
    await disablePopup(kind);
    await sendTelegramMessage(
      `🔴 <b>${LABEL[kind]} 자동 중단</b>\n`
      + `본 사람 구매율 ${(s.shownCvr * 100).toFixed(1)}% vs 안 본 사람 ${(s.holdoutCvr * 100).toFixed(1)}%\n`
      + `(${s.shown}명 / 홀드아웃 ${s.holdoutSize}명, 최근 14일)\n`
      + `방해가 되고 있어 껐습니다. 2026-07-08 웰컴팝업과 같은 양상입니다.`,
    ).catch(() => {});
    return { kind, disabled: true, stats: s };
  }
  return { kind, stats: s };
}

async function run(): Promise<Response> {
  // 팝업마다 따로 판단한다. 합쳐서 보면 한쪽이 해로울 때 애먼 쪽이 꺼진다.
  const results = [];
  for (const kind of ["hesitation", "cart"] as const) results.push(await judge(kind));
  if (results.every((r) => r.stats === null)) throw new Error("팝업 통계 조회 실패");
  return Response.json({ ok: true, results });
}

export const GET = withCron("popup-guard", run);
