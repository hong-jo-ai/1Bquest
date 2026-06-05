import { generateDraft } from "./draft";
import { sendReply } from "./reply";
import { getThread, getCsSupabase } from "./store";
import type { CsBrandId, CsMessage } from "./types";

type AutoReplyMode = "off" | "off_hours" | "always";

export interface CrispAutoReplyResult {
  ok: boolean;
  sent: boolean;
  reason: string;
  draft?: string;
  externalMessageId?: string;
  needsConfirmation?: string[];
  error?: string;
}

const FAQ_PATTERNS = [
  /store|shop|offline|visit|seoul|korea|where.*buy|buy.*in/i,
  /매장|오프라인|방문|서울|한국.*구매|구매.*한국/i,
  /restock|back\s*in\s*stock|available\s*again|sold\s*out/i,
  /재입고|품절|다시\s*입고|입고\s*예정/i,
  /engraving|engrave|personalization|personalized/i,
  /각인/i,
  /hotel|accommodation|travel|trip|delivery.*date|ship.*hotel/i,
  /숙소|호텔|여행|수령일|배송일/i,
];

const HIGH_RISK_PATTERNS = [
  /refund|return|exchange|cancel|chargeback|dispute|complaint/i,
  /환불|반품|교환|취소|분쟁|클레임|불만|컴플레인/i,
  /discount|coupon|wholesale|bulk|partnership|collaboration/i,
  /할인|쿠폰|도매|대량|제휴|협업/i,
  /repair|battery|warranty|broken|not working|service/i,
  /수리|배터리|보증|고장|작동|AS|A\/S/i,
  /address change|wrong address|tracking|customs|tax|duty/i,
  /주소\s*변경|오배송|송장|통관|관세|세금/i,
];

function autoReplyMode(): AutoReplyMode {
  const raw = (process.env.CS_CRISP_AUTO_REPLY_MODE ?? "off_hours").toLowerCase();
  if (raw === "always" || raw === "off" || raw === "off_hours") return raw;
  return "off_hours";
}

function enabledBrands(): Set<CsBrandId> {
  const raw = process.env.CS_CRISP_AUTO_REPLY_BRANDS ?? "harriot";
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
  return weekend || hour < 10 || hour >= 18;
}

function latestMessage(messages: CsMessage[]): CsMessage | undefined {
  return [...messages].sort((a, b) => {
    return new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime();
  })[messages.length - 1];
}

function textLooksAutomatable(text: string): boolean {
  if (!text.trim()) return false;
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return FAQ_PATTERNS.some((pattern) => pattern.test(text));
}

async function alreadyAutoHandled(threadId: string, latestInboundId: string | null) {
  if (!latestInboundId) return false;
  const db = getCsSupabase();
  const { data } = await db
    .from("cs_messages")
    .select("id")
    .eq("thread_id", threadId)
    .contains("raw", {
      sent_via: "crisp_auto_reply",
      reply_to_external_message_id: latestInboundId,
    })
    .limit(1);
  return Boolean(data?.length);
}

export async function maybeAutoReplyToCrispThread(
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
  if (thread.channel !== "crisp") {
    return { ok: true, sent: false, reason: "not_crisp" };
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
  const latestAt = new Date(latest.sent_at).getTime();
  if (!Number.isFinite(latestAt) || Date.now() - latestAt > maxInboundAgeMs()) {
    return { ok: true, sent: false, reason: "latest_inbound_too_old" };
  }
  if (await alreadyAutoHandled(threadId, latest.external_message_id)) {
    return { ok: true, sent: false, reason: "already_auto_handled" };
  }

  const text = latest.body_text ?? "";
  if (!textLooksAutomatable(text)) {
    return { ok: true, sent: false, reason: "not_in_auto_faq_scope" };
  }

  try {
    const draft = await generateDraft(threadId);
    if (draft.needsConfirmation.length > 0) {
      return {
        ok: true,
        sent: false,
        reason: "needs_confirmation",
        needsConfirmation: draft.needsConfirmation,
      };
    }

    const reply = await sendReply(threadId, draft.draft, {
      sentVia: "crisp_auto_reply",
      rawExtra: {
        reply_to_external_message_id: latest.external_message_id,
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
      draft: draft.draft,
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
