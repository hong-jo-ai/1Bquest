/**
 * CS 자동응대 에스컬레이션 — 업무외 시간에 자동응대 AI 가 확신하지 못한(needsConfirmation) 문의를
 * 사장님 텔레그램으로 보내고, 사장님이 "방향"을 답장하면 정식 답변으로 다듬어(미리보기) 발송한다.
 *
 * 흐름 (텔레그램 swipe-reply 로 스레드 매칭):
 *  1) 보류 발생 → 텔레그램에 [고객문의 + AI초안 + 확인필요] 전송. 그 메시지 id → kv `cs_escalation:{msgId}` (stage=await_direction)
 *  2) 사장님이 그 메시지에 답장(방향) → generateDraft(operatorNotes=방향) → 미리보기 전송. 미리보기 id → stage=await_confirm
 *  3) 미리보기에 "발송" 답장 → 고객에게 sendReply. 다른 방향 답장 → 재생성.
 */
import { generateDraft } from "./draft";
import { sendReply } from "./reply";
import { getCsSupabase } from "./store";
import { parseYesNo } from "@/lib/claudeBridge/queue";
import type { CsBrandId } from "./types";

const KEY = (msgId: number) => `cs_escalation:${msgId}`;
const BRAND_LABEL: Record<CsBrandId, string> = { paulvice: "폴바이스", harriot: "해리엇" };

interface EscalationState {
  threadId: string;
  brand: CsBrandId;
  stage: "await_direction" | "await_confirm";
  draft?: string;
  customerName?: string;
  createdAt: string;
}

function appBase(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://paulvice-dashboard.vercel.app";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 텔레그램 전송 후 message_id 반환 (swipe-reply 매칭용). */
async function tgSend(text: string, replyTo?: number): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[cs-escalation] 텔레그램 미설정 — 전송 생략");
    return null;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyTo ? { reply_to_message_id: replyTo } : {}),
      }),
    });
    const json = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
    return json?.result?.message_id ?? null;
  } catch (e) {
    console.error("[cs-escalation] 텔레그램 전송 오류:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function saveState(msgId: number, state: EscalationState): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").upsert(
    { key: KEY(msgId), data: state, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

async function loadState(msgId: number): Promise<EscalationState | null> {
  const db = getCsSupabase();
  const { data } = await db.from("kv_store").select("data").eq("key", KEY(msgId)).maybeSingle();
  return ((data as { data?: EscalationState } | null)?.data) ?? null;
}

async function clearState(msgId: number): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").delete().eq("key", KEY(msgId));
}

/** 보류 건을 사장님 텔레그램으로 에스컬레이션. */
export async function escalateUncertainToTelegram(input: {
  threadId: string;
  brand: CsBrandId;
  customerName?: string | null;
  customerQuestion: string;
  draft: string;
  needsConfirmation: string[];
}): Promise<{ ok: boolean; messageId?: number }> {
  const link = `${appBase()}/inbox?threadId=${encodeURIComponent(input.threadId)}`;
  const lines = [
    `🟠 <b>CS 자동응대 보류 — 확인 필요</b> (${BRAND_LABEL[input.brand]})`,
    input.customerName ? `👤 ${esc(input.customerName)}` : "",
    ``,
    `❓ <b>고객 문의</b>`,
    esc(input.customerQuestion.trim().slice(0, 500)),
    ``,
    `📝 <b>AI 초안</b>`,
    esc(input.draft.trim().slice(0, 600)),
    input.needsConfirmation.length
      ? `\n⚠️ <b>확인 필요</b>\n${input.needsConfirmation.map((c) => `· ${esc(c)}`).join("\n")}`
      : "",
    ``,
    `↪️ 이 메시지에 <b>답장</b>으로 방향만 알려주시면 정식 답변으로 다듬어 보여드릴게요.`,
    `   (예: "환불 처리, 배송비 6천원 공제하고 안내")`,
    `🔗 ${link}`,
  ].filter((l) => l !== "");
  const messageId = await tgSend(lines.join("\n"));
  if (!messageId) return { ok: false };
  await saveState(messageId, {
    threadId: input.threadId,
    brand: input.brand,
    stage: "await_direction",
    customerName: input.customerName ?? undefined,
    createdAt: new Date().toISOString(),
  });
  return { ok: true, messageId };
}

/**
 * 사장님이 에스컬레이션/미리보기 메시지에 답장했을 때 처리.
 * replyToMessageId 가 보류건이 아니면 null 반환(웹훅이 일반 처리 계속).
 */
export async function resolveEscalationReply(
  replyToMessageId: number,
  operatorText: string
): Promise<{ handled: boolean } | null> {
  const state = await loadState(replyToMessageId);
  if (!state) return null;
  await clearState(replyToMessageId); // 소비

  // 미리보기 확정 단계: "발송"이면 고객에게 전송, "아니/취소"면 중단, 그 외 텍스트는 새 방향으로 재생성
  if (state.stage === "await_confirm") {
    const t = operatorText.trim().toLowerCase().replace(/[.!~\s]+$/g, "");
    const isSend = /^(발송|발송해|발송해줘|보내|보내줘|전송|전송해|확정|컨펌)$/i.test(t) || parseYesNo(operatorText) === true;
    const isCancel = /^(보류|그만)$/i.test(t) || parseYesNo(operatorText) === false;
    const yn = isSend ? true : isCancel ? false : null;
    if (yn === true) {
      if (!state.draft) {
        await tgSend("⚠️ 보낼 초안이 없어요. 방향을 다시 알려주세요.");
        return { handled: true };
      }
      const reply = await sendReply(state.threadId, state.draft, {
        sentVia: "telegram_operator_reply",
      });
      await tgSend(reply.ok ? "✅ 고객에게 발송했어요." : `⚠️ 발송 실패: ${reply.error ?? "오류"}`);
      if (!reply.ok) {
        // 실패 시 같은 메시지로 재시도할 수 있게 상태 복구
        await saveState(replyToMessageId, state);
      }
      return { handled: true };
    }
    if (yn === false) {
      await tgSend("❌ 발송을 취소했어요. 대시보드 인박스에서 직접 처리하실 수 있어요.");
      return { handled: true };
    }
    // 그 외: 새 방향으로 간주 → 재생성
  }

  // 방향 → 정식 답변 다듬기 → 미리보기
  try {
    const draft = await generateDraft(state.threadId, { operatorNotes: operatorText });
    const previewLines = [
      `📝 <b>이렇게 보낼게요</b> (${BRAND_LABEL[state.brand]})`,
      ``,
      esc(draft.draft.trim()),
      ``,
      `↪️ 발송하려면 이 메시지에 <b>"발송"</b>으로 답장, 고치려면 다른 방향을 답장하세요.`,
    ];
    const previewId = await tgSend(previewLines.join("\n"));
    if (previewId) {
      await saveState(previewId, {
        threadId: state.threadId,
        brand: state.brand,
        stage: "await_confirm",
        draft: draft.draft,
        customerName: state.customerName,
        createdAt: new Date().toISOString(),
      });
    } else {
      await tgSend("⚠️ 미리보기 전송에 실패했어요. 대시보드 인박스에서 처리해 주세요.");
    }
  } catch (e) {
    await tgSend(`⚠️ 답변 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { handled: true };
}
