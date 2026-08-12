import { generateDraft } from "./draft";
import { sendReply } from "./reply";
import { getThread, getCsSupabase } from "./store";
import { escalateUncertainToTelegram } from "./csEscalation";
import { isKoreanPublicHoliday } from "@/lib/alba/attendance";
import type { CsBrandId, CsChannel, CsMessage } from "./types";

type AutoReplyMode = "off" | "off_hours" | "always";

/** 자동응대를 켤 채널 (자체 웹챗 + Crisp). */
const AUTO_CHANNELS: ReadonlySet<CsChannel> = new Set<CsChannel>(["webchat", "crisp", "cafe24_board"]);
// 이 채널들은 자동발송하지 않고 항상 사장님 텔레그램 확인 후 등록(공개글·상품확인 필요)
const CONFIRM_ONLY_CHANNELS: ReadonlySet<CsChannel> = new Set<CsChannel>(["cafe24_board"]);

export interface CrispAutoReplyResult {
  ok: boolean;
  sent: boolean;
  reason: string;
  draft?: string;
  externalMessageId?: string;
  needsConfirmation?: string[];
  error?: string;
}

function autoReplyMode(): AutoReplyMode {
  // 기본 off_hours — 업무시간(평일 9~18시 KST)엔 사장님이 직접 상담하므로 자동응대가 먼저
  // 끼어들면 대화가 꼬인다(사장님 지시 2026-08-12). 업무외에만 자동 1차응대. env로 always/off 전환 가능.
  const raw = (process.env.CS_CRISP_AUTO_REPLY_MODE ?? "off_hours").toLowerCase();
  if (raw === "always" || raw === "off" || raw === "off_hours") return raw;
  return "off_hours";
}

function enabledBrands(): Set<CsBrandId> {
  // 기본값: 폴바이스 + 해리엇 둘 다. (env 로 좁힐 수 있음)
  const raw = process.env.CS_CRISP_AUTO_REPLY_BRANDS ?? "paulvice,harriot";
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter((v): v is CsBrandId => v === "paulvice" || v === "harriot")
  );
}

function maxInboundAgeMs(): number {
  const minutes = Number(process.env.CS_CRISP_AUTO_REPLY_MAX_AGE_MINUTES ?? "30");
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  return safeMinutes * 60 * 1000;
}

/** KST 기준 "YYYY-MM-DD" (공휴일 조회용). */
function kstDateString(date: Date): string {
  // en-CA 로케일은 YYYY-MM-DD 형식
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 업무외 시간 여부: 주말 · 공휴일(종일) · 평일 9시 이전/18시 이후 (업무시간 = 월~금 09~18시 KST). */
function isOffHoursKst(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekend = weekday === "Sat" || weekday === "Sun";
  if (weekend) return true;
  if (isKoreanPublicHoliday(kstDateString(date))) return true;
  return hour < 9 || hour >= 18;
}

function latestMessage(messages: CsMessage[]): CsMessage | undefined {
  return [...messages].sort((a, b) => {
    return new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime();
  })[messages.length - 1];
}

/** 같은 인입 메시지에 이미 자동응대했는지 (중복 발송 방지). 웹챗은 external_message_id 가 없을 수 있어 message id 로 폴백. */
async function alreadyAutoHandled(threadId: string, inboundKey: string | null) {
  if (!inboundKey) return false;
  const db = getCsSupabase();
  const { data } = await db
    .from("cs_messages")
    .select("id")
    .eq("thread_id", threadId)
    .contains("raw", {
      sent_via: "auto_reply_off_hours",
      reply_to_external_message_id: inboundKey,
    })
    .limit(1);
  return Boolean(data?.length);
}

/** "가볍게 표시" — 자동응대임을 알리는 한 줄 (고객 언어 + 시간대에 맞춤). */
function disclosureLine(draftText: string, offHours: boolean): string {
  const hasKorean = /[가-힣]/.test(draftText);
  if (offHours) {
    return hasKorean
      ? "💬 영업시간 외라 자동으로 먼저 안내드려요. 추가 확인이 필요한 내용은 영업시간에 담당자가 이어서 도와드릴게요.\n\n"
      : "💬 Quick automated reply outside our business hours — our team will follow up during business hours if anything else is needed.\n\n";
  }
  // 업무시간: '영업시간 외' 문구 없이 가벼운 자동 안내
  return hasKorean
    ? "💬 빠르게 자동으로 먼저 안내드려요. 더 확인이 필요하면 담당자가 이어서 도와드릴게요.\n\n"
    : "💬 Quick automated reply — our team will follow up if anything else is needed.\n\n";
}

/**
 * 업무외 시간/휴일에 들어온 CS 문의(자체 웹챗·Crisp)에 자동으로 1차 답변.
 * - 최대한 다 자동응대(FAQ 제한 없음). 단 generateDraft 가 needsConfirmation 을 남기면(불확실/조치필요) 발송하지 않고 보류.
 * - 응답 앞에 "자동 안내" 한 줄(가볍게 표시).
 */
export async function maybeAutoReplyOffHours(
  threadId: string
): Promise<CrispAutoReplyResult> {
  const mode = autoReplyMode();
  if (mode === "off") return { ok: true, sent: false, reason: "disabled" };
  if (mode === "off_hours" && !isOffHoursKst()) {
    return { ok: true, sent: false, reason: "working_hours" };
  }

  const data = await getThread(threadId);
  if (!data) return { ok: false, sent: false, reason: "thread_not_found" };

  const { thread, messages } = data;
  if (!AUTO_CHANNELS.has(thread.channel)) {
    return { ok: true, sent: false, reason: `channel_${thread.channel}_disabled` };
  }
  if (!enabledBrands().has(thread.brand)) {
    return { ok: true, sent: false, reason: "brand_disabled" };
  }
  if (thread.status !== "unanswered") {
    return { ok: true, sent: false, reason: `status_${thread.status}` };
  }

  const latest = latestMessage(messages);
  if (!latest || latest.direction !== "in") {
    return { ok: true, sent: false, reason: "latest_not_inbound" };
  }
  // 게시판은 폴링 인입이라 글이 좀 묵을 수 있어 나이 체크 제외(채팅 채널만 30분 가드)
  const latestAt = new Date(latest.sent_at).getTime();
  if (!CONFIRM_ONLY_CHANNELS.has(thread.channel) && (!Number.isFinite(latestAt) || Date.now() - latestAt > maxInboundAgeMs())) {
    return { ok: true, sent: false, reason: "latest_inbound_too_old" };
  }
  const inboundKey = latest.external_message_id ?? latest.id;
  if (await alreadyAutoHandled(threadId, inboundKey)) {
    return { ok: true, sent: false, reason: "already_auto_handled" };
  }

  const text = latest.body_text ?? "";
  if (!text.trim()) {
    return { ok: true, sent: false, reason: "empty_inbound" };
  }

  try {
    const draft = await generateDraft(threadId);
    // 불확실(needsConfirmation) 이거나, 항상-확인 채널(게시판)이면 자동발송하지 않고 사장님 텔레그램으로 에스컬레이션.
    if (draft.needsConfirmation.length > 0 || CONFIRM_ONLY_CHANNELS.has(thread.channel)) {
      await escalateUncertainToTelegram({
        threadId,
        brand: thread.brand,
        customerName: thread.customer_name,
        customerQuestion: text,
        draft: draft.draft,
        needsConfirmation: draft.needsConfirmation,
      }).catch((e) =>
        console.warn("[auto-reply] 에스컬레이션 실패:", e instanceof Error ? e.message : String(e))
      );
      return {
        ok: true,
        sent: false,
        reason: "needs_confirmation",
        needsConfirmation: draft.needsConfirmation,
      };
    }

    const finalText = disclosureLine(draft.draft, isOffHoursKst()) + draft.draft;
    const reply = await sendReply(threadId, finalText, {
      sentVia: "auto_reply_off_hours",
      rawExtra: {
        reply_to_external_message_id: inboundKey,
        rationale: draft.rationale,
      },
    });
    if (!reply.ok) {
      return {
        ok: false,
        sent: false,
        reason: "send_failed",
        error: reply.error,
      };
    }

    return {
      ok: true,
      sent: true,
      reason: "sent",
      draft: finalText,
      externalMessageId: reply.externalMessageId,
    };
  } catch (e) {
    return {
      ok: false,
      sent: false,
      reason: "auto_reply_failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 하위호환 별칭 (Crisp 웹훅에서 사용). 채널 무관하게 동작. */
export const maybeAutoReplyToCrispThread = maybeAutoReplyOffHours;
