/**
 * 약속 알림 — 지정한 날 아침 텔레그램으로 상기시킨다.
 *
 * ⚠️ 전용 크론을 만들지 않았다. vercel.json 크론이 이미 41개(상한 40)라 새 슬롯을 쓸 수 없어서,
 *    매일 KST 10시에 도는 low-stock-alert 크론에 얹었다(app/api/cron/low-stock-alert/route.ts).
 *    슬롯이 생기면 독립 크론으로 떼는 편이 낫다.
 */
import { dueForReminder, markNotified, todayKst, type CsPromise } from "./promises";
import { sendTelegramMessage } from "./telegram";

export async function notifyDuePromises(): Promise<{ sent: number; failed?: number }> {
  const today = todayKst();
  const due = await dueForReminder(today);
  if (!due.length) return { sent: 0 };

  const lines = [
    `📌 <b>오늘 지킬 약속 ${due.length}건</b>`,
    "",
    ...due.map((p) => `• ${describe(p, today)}`),
    "",
    `<i>완료하면 CS 인박스에서 해당 대화의 약속 배너에 '완료'를 누르세요.</i>`,
  ];

  // ⚠️ 발송 성공을 확인한 뒤에만 "오늘 보냄"으로 표시한다.
  //    실패했는데 표시해버리면 그날 재시도가 막혀 약속이 조용히 유실된다
  //    (2026-08-28 검증 중 실제로 재현 — 네트워크 실패인데 sent 로 기록됐다).
  const ok = await sendTelegramMessage(lines.join("\n"));
  if (!ok) return { sent: 0, failed: due.length };
  await markNotified(due.map((p) => p.id), today);
  return { sent: due.length };
}

function describe(p: CsPromise, today: string): string {
  const who = p.customerName ? `<b>${escapeHtml(p.customerName)}</b> · ` : "";
  const order = p.orderNumber ? ` <code>${escapeHtml(p.orderNumber)}</code>` : "";
  let deadline = "";
  if (p.dueOn) {
    // 마감이 오늘이거나 지났으면 눈에 띄게 — 이 알림의 존재 이유다.
    const days = daysBetween(today, p.dueOn);
    deadline =
      days < 0
        ? ` <b>⚠️ 마감 ${p.dueOn} 지남</b>`
        : days === 0
          ? ` <b>⚠️ 오늘 마감</b>`
          : ` (마감 ${p.dueOn}, D-${days})`;
  }
  return `${who}${escapeHtml(p.text)}${order}${deadline}`;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00+09:00`);
  const b = Date.parse(`${to}T00:00:00+09:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
