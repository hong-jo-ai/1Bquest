/**
 * AS 발송완료 → 안내 **초안**을 만들어 사장님 확인을 받고 발송 + CS 스레드 종료.
 *
 * 배경(2026-08-05): AS 가 shipped 로 바뀌어도 연결된 CS 스레드는 그대로 열려 있었다.
 *   실사례 — 이윤주 님(AS-260720-002): 8/3 "진행상황 알려달라" 문의 → 8/4 수리완료 발송했지만
 *   사장님이 개인폰으로 문자를 보내야 했고, 인박스엔 "확인 후 연락드리겠습니다"가 미결로 남았다.
 *
 * ⚠️ **자동발송 안 함 — 확인카드 방식.** 처음엔 자동발송으로 만들었다가 되돌렸다.
 *   실측(2026-08-05, shipped 28건): 수리내역 19건·수리비 17건·등기번호 13건이 비어 있고,
 *   request_type=refund 7 / exchange 8 중엔 "W컨셉 단순변심 반품 처리완료"처럼
 *   **고객에게 아무것도 보내지 않는** 마켓 반품 건이 섞여 있다. 즉 status=shipped 는
 *   "고객에게 발송함"을 뜻하지 않는다. 그대로 자동발송하면 틀린 안내가 나간다.
 *   CS 규칙("불확실하면 발송 금지 → 미리보기 → 확인 후 발송")에도 확인 단계가 맞다.
 *
 * 흐름: shipped 감지 → 초안 + 위험신호를 텔레그램 확인카드로 → 「✅ 이대로 발송」 누르면
 *   미리본 문구 그대로 발송(채널 답장 또는 문자) + 스레드 종료. 「❌ 내가 직접」이면 표시만 남긴다.
 *
 * 발송 경로
 *   - cs_thread_id 있음 → 해당 채널로 답장(sendReply). 채널이 알아서 알린다
 *     (웹챗=SMS 링크, ig_dm=DM, gmail=메일). 이후 스레드를 resolved 로 닫는다.
 *   - 없으면 고객 휴대폰 SMS(사장님이 손으로 하던 것).
 *   - 공개 채널(게시판 등)엔 **등기번호를 쓰지 않는다** — 누구나 조회 가능해 배송지가 노출된다.
 *     등기번호는 문자로 따로.
 */
import { getCsSupabase, getThread } from "./store";
import { sendReply } from "./reply";
import { sendTelegramMessage } from "./telegram";
import { detectMessageType, estimateCost, sendMany, smsConfigured } from "../sms/solapi";
import { logSmsSend } from "../sms/store";
import type { CsChannel } from "./types";

const BRAND_LABEL: Record<string, string> = { paulvice: "PAULVICE", harriot: "HARRIOT" };

// 누구나 볼 수 있는 채널 — 등기번호·주소 같은 개인정보를 쓰면 안 된다.
const PUBLIC_CHANNELS: CsChannel[] = ["cafe24_board", "sixshop_board", "sixshop", "threads", "reddit", "ig_comment"];

export interface AsShippedNotifyResult {
  ok: boolean;
  via?: "thread" | "sms";
  skipped?: string;
  error?: string;
}

interface AsRow {
  id: string;
  as_number: string | null;
  brand: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  channel: string | null;
  model: string | null;
  symptom: string | null;
  status: string | null;
  request_type: string | null;
  repair_detail: string | null;
  repair_cost: number | null;
  return_tracking_no: string | null;
  cs_thread_id: string | null;
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

// 확인카드는 parse_mode=HTML 로 나간다 — 고객 문구에 <, & 가 있어도 카드가 깨지지 않게.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 국내 우체국 접수 건이라 한국어가 기본. 한국 번호가 없을 때만 영문. */
function isKorean(as: AsRow): boolean {
  const d = (as.customer_phone ?? "").replace(/\D/g, "");
  return d.startsWith("010") || d.startsWith("01") || d.startsWith("8210") || d === "";
}

/** 이름이 있으면 "○○○님", 없으면 기본값 그대로("고객님"에 님을 또 붙이지 않는다). */
function honorific(name: string): string {
  return name === "고객님" ? name : `${name}님`;
}

function costLine(cost: number | null): string | null {
  if (cost == null) return null;
  return cost === 0 ? "· 수리비: 무상" : `· 수리비: ${cost.toLocaleString("ko-KR")}원`;
}

/** 안내 문구. withTracking=false 면 등기번호를 뺀다(공개 채널용). */
function buildMessage(as: AsRow, withTracking: boolean): string {
  const label = BRAND_LABEL[as.brand ?? "paulvice"] ?? "PAULVICE";
  const name = as.customer_name?.trim() || "고객님";
  const isExchange = as.request_type === "exchange";
  const item = as.model?.trim();
  const tracking = withTracking && as.return_tracking_no ? as.return_tracking_no : null;

  if (!isKorean(as)) {
    const lines = [
      `Hello ${name},`,
      "",
      isExchange
        ? `Your replacement${item ? ` (${item})` : ""} has been shipped.`
        : `The repair on your${item ? ` ${item}` : " watch"} is complete and it has been shipped back to you.`,
    ];
    if (!isExchange && as.repair_detail?.trim()) lines.push(`· Repair: ${as.repair_detail.trim()}`);
    if (tracking) lines.push(`· Tracking (Korea Post): ${tracking}`);
    lines.push("", "Please let us know here if anything is not right when it arrives.", "", `Thank you — ${label}`);
    return lines.join("\n");
  }

  const lines = [
    `안녕하세요, ${honorific(name)}. ${label}입니다.`,
    "",
    isExchange
      ? `교환 상품${item ? `(${item})` : ""}을 발송해 드렸습니다.`
      : `맡겨주신 ${item ? `${item} ` : ""}수리가 완료되어 발송해 드렸습니다.`,
  ];
  if (!isExchange && as.repair_detail?.trim()) lines.push(`· 수리 내역: ${as.repair_detail.trim()}`);
  const cost = isExchange ? null : costLine(as.repair_cost);
  if (cost) lines.push(cost);
  if (tracking) lines.push(`· 등기번호: ${tracking} (우체국)`);
  lines.push("", "받으신 뒤 이상이 있으면 편하게 알려주세요.", "감사합니다.");
  return lines.join("\n");
}

/** SMS 는 길이가 곧 비용 — 링크 없이 핵심만. */
function buildSmsText(as: AsRow): string {
  const label = BRAND_LABEL[as.brand ?? "paulvice"] ?? "PAULVICE";
  const name = as.customer_name?.trim() || "고객님";
  const isExchange = as.request_type === "exchange";
  const head = isExchange
    ? `${honorific(name)}, ${label} 교환 상품을 발송해 드렸습니다.`
    : `${honorific(name)}, ${label} 수리가 완료되어 발송해 드렸습니다.`;
  const tail = as.return_tracking_no ? `\n등기번호 ${as.return_tracking_no} (우체국)` : "";
  return `${head}${tail}\n받으신 뒤 이상이 있으면 연락 주세요.`;
}

/** 외부 채널 주문 — 고객 연락처가 마켓 것이거나 직접 연락이 규정 위반일 수 있다. */
const MARKETPLACE_HINT = /(W컨셉|wconcept|29CM|무신사|musinsa|카카오|kakao|네이버|스마트스토어)/i;

/** 문구가 얄팍해지거나 사실과 어긋날 수 있는 지점 — 확인카드에 그대로 띄운다. */
function draftWarnings(as: AsRow, channel: CsChannel | null): string[] {
  const w: string[] = [];
  if (as.request_type !== "exchange" && !as.repair_detail?.trim()) w.push("수리내역 비어 있음 — 문구에 내역 줄이 빠집니다");
  if (as.request_type !== "exchange" && as.repair_cost == null) w.push("수리비 미입력 — 무상인지 유상인지 안 적힙니다");
  if (!as.return_tracking_no) w.push("등기번호 없음 — 송장 안내 없이 나갑니다");
  if (!as.model?.trim()) w.push("모델명 없음");
  if (MARKETPLACE_HINT.test(as.channel ?? "")) w.push(`외부채널(${as.channel}) 주문 — 직접 연락이 맞는지 확인 필요`);
  if (channel && PUBLIC_CHANNELS.includes(channel)) w.push("공개 채널이라 등기번호를 뺐습니다(문자로 따로 발송)");
  return w;
}

/**
 * AS 발송완료 안내 **초안 작성 + 확인 요청**.
 *
 * ⚠️ 자동으로 보내지 않는다. 사장님이 지금 하시는 대로 "수리비·내역 확인 → 문구 확인 → 발송"을
 *    유지하되, 초안 작성과 발송·스레드 종료만 대신한다.
 *    실측(2026-08-05) — shipped 28건 중 수리내역 19건·수리비 17건·등기번호 13건이 비어 있고,
 *    request_type=refund/exchange 15건엔 고객에게 아무것도 안 보내는 마켓 반품 처리건이 섞여 있다.
 *    이 상태로 자동발송하면 틀린 안내가 나간다.
 */
export async function notifyAsShipped(asId: string): Promise<AsShippedNotifyResult> {
  const db = getCsSupabase();
  const { data, error } = await db
    .from("as_requests")
    .select(
      "id, as_number, brand, customer_name, customer_phone, channel, model, symptom, status, request_type, repair_detail, repair_cost, return_tracking_no, cs_thread_id"
    )
    .eq("id", asId)
    .maybeSingle();
  if (error) return { ok: false, error: `as_requests 조회 실패: ${error.message}` };
  const as = data as AsRow | null;
  if (!as) return { ok: false, skipped: "as_not_found" };
  if (as.status !== "shipped") return { ok: false, skipped: `status_not_shipped:${as.status}` };

  // 환불 건은 회송·환불금·계좌 상태가 건마다 달라 초안 자체를 만들 수 없다 → 알림만.
  if (as.request_type === "refund") {
    await claimAndNotifyBoss(db, as, "환불 건이라 초안을 만들지 않았습니다. 직접 안내해 주세요.");
    return { ok: false, skipped: "refund_needs_manual" };
  }

  // ── 중복 요청 차단(선점) ──────────────────────────────────────
  const key = `as_shipped_notified:${asId}`;
  const now = new Date().toISOString();

  const threadData = as.cs_thread_id ? await getThread(as.cs_thread_id) : null;
  const channel = threadData?.thread.channel ?? null;
  const isPublic = channel ? PUBLIC_CHANNELS.includes(channel) : false;
  const phone = normalizePhone(as.customer_phone);

  const body = buildMessage(as, !isPublic);
  const smsText = buildSmsText(as);
  const route: "thread" | "sms" | null = threadData ? "thread" : phone && smsConfigured().ok ? "sms" : null;

  if (!route) {
    await claimAndNotifyBoss(db, as, phone ? "SMS 설정이 없어" : "연락처·CS대화가 모두 없어");
    return { ok: false, skipped: "no_contact" };
  }

  const { error: claimError } = await db.from("kv_store").insert({
    key,
    data: {
      status: "pending",
      asId,
      asNumber: as.as_number,
      route,
      threadId: as.cs_thread_id,
      body,
      smsText,
      smsAlso: route === "thread" && isPublic && !!as.return_tracking_no,
      createdAt: now,
    },
    updated_at: now,
  });
  if (claimError) {
    if (claimError.code === "23505") return { ok: false, skipped: "already_handled" };
    return { ok: false, error: `claim_failed:${claimError.message}` };
  }

  const warnings = draftWarnings(as, channel);
  const preview = route === "thread" ? body : smsText;
  await sendTelegramMessage(
    `📦 <b>AS 발송 안내 초안</b> — 보낼까요?\n\n` +
      `${escapeHtml(as.customer_name ?? "-")}님 · ${escapeHtml(as.model ?? "-")}` +
      `${as.as_number ? ` (${escapeHtml(as.as_number)})` : ""}\n` +
      `보낼 곳: ${route === "thread" ? `CS 대화(${channel})` : `문자 ${phone}`}\n` +
      (warnings.length ? `\n⚠️ ${warnings.map(escapeHtml).join("\n⚠️ ")}\n` : "") +
      `\n────────\n${escapeHtml(preview)}\n────────`,
    {
      buttons: [
        { text: "✅ 이대로 발송", callback_data: `asnotify:accept:${asId}` },
        { text: "❌ 내가 직접", callback_data: `asnotify:reject:${asId}` },
      ],
    }
  ).catch(() => {});

  return { ok: true, via: route, skipped: "awaiting_confirm" };
}

/** 확인카드에서 "이대로 발송" 선택 시 실제 발송 — 미리보기와 똑같은 문구를 보낸다. */
export async function sendPreparedAsNotice(
  asId: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const db = getCsSupabase();
  const key = `as_shipped_notified:${asId}`;
  const { data: row } = await db.from("kv_store").select("data").eq("key", key).maybeSingle();
  const pending = row?.data as
    | { status?: string; route?: "thread" | "sms"; threadId?: string; body?: string; smsText?: string; smsAlso?: boolean; asNumber?: string }
    | undefined;
  if (!pending) return { ok: false, error: "초안을 찾을 수 없습니다" };
  if (pending.status !== "pending") return { ok: false, error: `이미 처리됨(${pending.status})` };

  // 먼저 pending 을 걷어 중복 클릭을 막는다.
  await db.from("kv_store").update({
    data: { ...pending, status: "sending" },
    updated_at: new Date().toISOString(),
  }).eq("key", key);

  const revert = async () => {
    await db.from("kv_store").update({ data: { ...pending, status: "pending" }, updated_at: new Date().toISOString() }).eq("key", key);
  };

  try {
    let via: "thread" | "sms" | null = null;

    if (pending.route === "thread" && pending.threadId && pending.body) {
      const res = await sendReply(pending.threadId, pending.body, {
        sentVia: "as_shipped_confirmed",
        rawExtra: { as_id: asId, as_number: pending.asNumber },
      });
      if (!res.ok) { await revert(); return { ok: false, error: res.error ?? "답장 실패" }; }
      via = "thread";
      // sendReply 는 답장 후 waiting 으로 되돌린다 — 발송완료 안내는 대화의 끝이므로 닫는다.
      await db.from("cs_threads").update({ status: "resolved", updated_at: new Date().toISOString() })
        .eq("id", pending.threadId);
    }

    if (pending.route === "sms" || pending.smsAlso) {
      const { data: as } = await db
        .from("as_requests")
        .select("customer_name, customer_phone, brand, as_number")
        .eq("id", asId)
        .maybeSingle();
      const phone = normalizePhone((as as { customer_phone?: string } | null)?.customer_phone);
      const text = pending.smsText ?? "";
      if (phone && text) {
        const outcome = await sendMany([{ to: phone, text, subject: `${BRAND_LABEL[(as as { brand?: string } | null)?.brand ?? "paulvice"]} AS 발송 안내` }]);
        try {
          await logSmsSend({
            messageText: text,
            messageType: detectMessageType(text),
            sourceDesc: `AS 발송완료 안내 · ${pending.asNumber ?? asId}`,
            recipientCount: 1,
            successCount: outcome.successCount,
            failCount: outcome.failCount,
            estCost: estimateCost(text, 1),
            groupId: outcome.groupId,
            results: outcome.results.map((r) => ({ ...r, name: (as as { customer_name?: string } | null)?.customer_name ?? "", text: r.text ?? text })),
            isTest: false,
          });
        } catch (e) {
          console.error("[as-shipped] SMS 이력 기록 실패:", e instanceof Error ? e.message : String(e));
        }
        if (!outcome.ok && via !== "thread") { await revert(); return { ok: false, error: outcome.error ?? "문자 발송 실패" }; }
        if (outcome.ok && !via) via = "sms";
      } else if (!via) {
        await revert();
        return { ok: false, error: "연락처가 없어 보낼 수 없습니다" };
      }
    }

    await db.from("kv_store").update({
      data: { ...pending, status: "sent", via, sentAt: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }).eq("key", key);

    return { ok: true, summary: via === "thread" ? "CS 대화로 발송 · 스레드 종료" : "문자 발송" };
  } catch (e) {
    await revert();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "내가 직접" 선택 — 다시 카드가 뜨지 않게 표시만 남긴다. */
export async function rejectPreparedAsNotice(asId: string): Promise<{ ok: boolean }> {
  const db = getCsSupabase();
  const key = `as_shipped_notified:${asId}`;
  const { data: row } = await db.from("kv_store").select("data").eq("key", key).maybeSingle();
  const pending = (row?.data ?? {}) as Record<string, unknown>;
  await db.from("kv_store").update({
    data: { ...pending, status: "manual", rejectedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq("key", key);
  return { ok: true };
}

async function notifyBoss(as: AsRow, reason: string): Promise<void> {
  await sendTelegramMessage(
    `⚠️ AS 발송 안내를 못 보냈습니다 (${reason})\n\n` +
      `${as.customer_name ?? "-"}님 · ${as.model ?? "-"}${as.as_number ? ` (${as.as_number})` : ""}\n` +
      `${as.return_tracking_no ? `등기 ${as.return_tracking_no}\n` : ""}직접 안내해 주세요.`
  ).catch(() => {});
}

/** 환불 등 자동발송 대상이 아닌 건 — 선점 키를 남겨 반복 알림을 막고 사장님께 1회만 알린다. */
async function claimAndNotifyBoss(
  db: ReturnType<typeof getCsSupabase>,
  as: AsRow,
  reason: string
): Promise<void> {
  const key = `as_shipped_notified:${as.id}`;
  const now = new Date().toISOString();
  const { error } = await db.from("kv_store").insert({
    key,
    data: { status: "manual", asId: as.id, asNumber: as.as_number, reason, createdAt: now },
    updated_at: now,
  });
  if (error) return; // 이미 처리됨(23505) — 재알림 안 함
  await notifyBoss(as, reason);
}

/**
 * 초안 미작성 스위퍼 — AS 상태를 shipped 로 바꾸는 경로가 둘(배포서버 as-ship 라우트,
 * 아이맥 asPaymentWatch.js)이라 한쪽에 훅을 걸어도 새는 건이 생긴다. 여기서 회수한다.
 * notifyAsShipped 가 자체 선점 가드를 가지므로 후보만 순회하면 안전하다.
 * prepared = 확인카드를 띄운 건수. **발송 건수가 아니다** — 발송은 사장님이 버튼을 눌러야 일어난다.
 */
export async function sweepAsShippedNotifications(): Promise<{ checked: number; prepared: number }> {
  const db = getCsSupabase();
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: rows } = await db
    .from("as_requests")
    .select("id")
    .eq("status", "shipped")
    .gte("shipped_at", since)
    .limit(50);
  let prepared = 0;
  for (const r of rows ?? []) {
    try {
      const res = await notifyAsShipped(r.id as string);
      if (res.ok) prepared++;
    } catch { /* 개별 실패 무시 — 다음 회차에서 재시도 */ }
  }
  return { checked: (rows ?? []).length, prepared };
}
