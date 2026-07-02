/**
 * 미매칭 입금 재시도 크론.
 *
 * 입금 SMS가 주문 등록보다 먼저 도착(타이밍 역전)해 최초 매칭이 0건이면
 * webhook이 재시도 큐(bank_deposit_pending:*)에 적재한다. 이 크론이 주기적으로
 * 큐를 재매칭한다:
 *   - 주문이 들어와 HIGH → 브라우저 입금확인 큐 적재(iMac 워처가 처리), ✅ 알림, 큐에서 제거
 *   - 주문이 들어왔으나 HIGH 아님(복수/이름미확인) → 알림, 큐에서 제거(수동)
 *   - 아직 0건 + 30분 이내 → 큐 유지(다음 크론에 재시도)
 *   - 아직 0건 + 30분 경과 → ❓ 수동 확인 알림, 큐에서 제거
 */
import { resolveDeposit, formatNotification, type ResolveResult } from "@/lib/bankDeposit/resolve";
import { listPending, bumpPendingAttempt, removePending, RETRY_WINDOW_MS } from "@/lib/bankDeposit/pending";
import { enqueueConfirm } from "@/lib/bankDeposit/confirmQueue";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { withCron } from "@/lib/cron/withCron";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

async function run() {
  const pending = await listPending();
  let confirmed = 0, resolved = 0, expired = 0, stillWaiting = 0;

  for (const rec of pending) {
    const ageMs = Date.now() - new Date(rec.firstSeen).getTime();
    const expiredNow = ageMs > RETRY_WINDOW_MS;

    let res: ResolveResult;
    try {
      res = await resolveDeposit(rec.parsed);
    } catch (e) {
      // 조회 자체 실패(토큰/네트워크) — 만료 전이면 다음 크론에 재시도.
      if (!expiredNow) { await bumpPendingAttempt(rec); stillWaiting++; continue; }
      res = { candidates: [], confirmTarget: null, matchError: e instanceof Error ? e.message : String(e) };
    }
    const { candidates, confirmTarget, matchError } = res;

    // HIGH 매칭 → 브라우저 입금확인 큐 적재 + 알림 + 큐 제거.
    if (confirmTarget) {
      await enqueueConfirm(confirmTarget.orderId, confirmTarget.mall, confirmTarget.amount, confirmTarget.name);
      await sendTelegramMessage(formatNotification(rec.parsed, candidates, { note: "재시도 매칭" }));
      await removePending(rec.hash);
      confirmed++;
      continue;
    }

    // 주문이 들어왔으나 HIGH 아님(복수/이름미확인) → 알림 + 큐 제거(수동 처리).
    if (candidates.length > 0) {
      await sendTelegramMessage(formatNotification(rec.parsed, candidates, { note: "재시도 매칭" }));
      await removePending(rec.hash);
      resolved++;
      continue;
    }

    // 아직 0건 — 30분 지났으면 포기(수동), 아니면 큐 유지.
    if (expiredNow) {
      let text = formatNotification(rec.parsed, [], { note: "30분 경과 — 자동매칭 실패" });
      if (matchError) text += `\n<i>⚠ 매칭 조회 실패: ${matchError.replace(/</g, "&lt;")}</i>`;
      await sendTelegramMessage(text);
      await removePending(rec.hash);
      expired++;
    } else {
      await bumpPendingAttempt(rec);
      stillWaiting++;
    }
  }

  return Response.json({ ok: true, pending: pending.length, confirmed, resolved, expired, stillWaiting });
}

export const GET = withCron("bank-deposit-retry", () => run());

export async function POST() {
  return run();
}
