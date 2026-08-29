/**
 * 배송완료 자동 전환 크론 — 종추적이 배달완료면 카페24 주문도 배송완료로 옮긴다.
 *
 * 종추적 갱신(parcel-track, KST 09/14/21시) 직후에 돌아야 방금 확인된 배달완료가
 * 같은 날 반영된다. 그래서 20분 뒤로 맞춰 뒀다.
 */
import { withCron } from "@/lib/cron/withCron";
import { flipDeliveredOrders, type FlipResult } from "@/lib/cafe24/deliveryComplete";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import type { MallId } from "@/lib/cafe24Client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(): Promise<Response> {
  const results: Array<FlipResult | { mall: MallId; error: string }> = [];
  for (const mall of ["paulvice", "harriot"] as const) {
    try {
      results.push(await flipDeliveredOrders(mall, { days: 14, confirm: true }));
    } catch (e) {
      // 한 몰이 실패해도 다른 몰은 처리한다 — 해리엇 토큰 문제로 폴바이스가 멈추면 안 된다.
      results.push({ mall, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const flipped = results.reduce((a, r) => a + ("flipped" in r ? r.flipped : 0), 0);
  const stale = results.flatMap((r) => ("naverPayStale" in r ? r.naverPayStale : []));
  const failed = results.flatMap((r) => ("failed" in r ? r.failed : []));
  const errored = results.filter((r) => "error" in r) as Array<{ mall: MallId; error: string }>;

  // 실패는 조용히 넘기지 않는다. 성공은 굳이 알리지 않는다(하루 3회라 금방 소음이 된다).
  if (failed.length || errored.length) {
    await sendTelegramMessage(
      `⚠️ <b>배송완료 자동전환 일부 실패</b>\n`
      + (flipped ? `성공 ${flipped}건\n` : "")
      + errored.map((e) => `${e.mall}: ${e.error}`).join("\n")
      + failed.slice(0, 5).map((f) => `${f.orderId}: ${f.reason}`).join("\n"),
    ).catch(() => {});
  }
  // 네이버페이 정체건은 우리가 API 로 못 고친다 → 사람이 판매자센터에서 밀어야 한다.
  // 하루 3회 다 알리면 소음이라 아침 실행(KST 09시대)에만 알린다.
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  if (stale.length && kstHour < 12) {
    await sendTelegramMessage(
      `📦 <b>네이버페이 배송완료 정체 ${stale.length}건</b>\n`
      + `배달은 끝났는데 일주일 넘게 배송중입니다. 카페24 API 로는 못 바꿉니다 —\n`
      + `네이버 판매자센터에서 발송처리해 주세요.\n\n${stale.slice(0, 10).join("\n")}`,
    ).catch(() => {});
  }
  return Response.json({ ok: true, flipped, naverPayStale: stale.length, results });
}

export const GET = withCron("delivery-complete", run);
