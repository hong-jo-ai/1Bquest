/**
 * AS 발송완료 → 고객 자동 안내 + CS 스레드 종료.
 *
 * 배경(2026-08-05): AS 가 shipped 로 바뀌어도 연결된 CS 스레드는 그대로 열려 있었다.
 *   실사례 — 이윤주 님(AS-260720-002): 8/3 "진행상황 알려달라" 문의 → 8/4 수리완료 발송했지만
 *   사장님이 개인폰으로 문자를 보내야 했고, 인박스엔 "확인 후 연락드리겠습니다"가 미결로 남았다.
 *
 * 발송 경로
 *   - cs_thread_id 있음 → 해당 채널로 답장(sendReply). 채널이 알아서 알린다
 *     (웹챗=SMS 링크, ig_dm=DM, gmail=메일). 이후 스레드를 resolved 로 닫는다.
 *   - cs_thread_id 없음 → 고객 휴대폰으로 SMS 직접 발송(사장님이 손으로 하던 것).
 *   - 공개 채널(게시판·스레드 등)엔 **등기번호를 쓰지 않는다** — 누구나 조회 가능해 배송지가 노출된다.
 *     대신 등기번호는 SMS 로 따로 보낸다.
 *
 * ⚠️ request_type 이 refund 인 건은 자동발송하지 않는다. 환불은 회송·환불금·계좌 상태가
 *    건마다 달라 문구를 단정할 수 없다 — CS 규칙(불확실하면 발송 금지)에 따라 텔레그램으로 넘긴다.
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

/**
 * AS 발송완료 안내. 같은 AS 에 두 번 나가지 않는다(kv unique insert 로 선점).
 */
export async function notifyAsShipped(asId: string): Promise<AsShippedNotifyResult> {
  const db = getCsSupabase();
  const { data, error } = await db
    .from("as_requests")
    .select(
      "id, as_number, brand, customer_name, customer_phone, model, symptom, status, request_type, repair_detail, repair_cost, return_tracking_no, cs_thread_id"
    )
    .eq("id", asId)
    .maybeSingle();
  if (error) return { ok: false, error: `as_requests 조회 실패: ${error.message}` };
  const as = data as AsRow | null;
  if (!as) return { ok: false, skipped: "as_not_found" };
  if (as.status !== "shipped") return { ok: false, skipped: `status_not_shipped:${as.status}` };

  // 환불 건은 문구를 단정할 수 없다 → 사장님께 넘긴다(CS 규칙: 불확실하면 발송 금지).
  if (as.request_type === "refund") {
    await claimAndNotifyBoss(db, as, "환불 건이라 자동 안내를 보내지 않았습니다. 직접 안내해 주세요.");
    return { ok: false, skipped: "refund_needs_manual" };
  }

  // ── 중복 발송 차단(선점) ──────────────────────────────────────
  const key = `as_shipped_notified:${asId}`;
  const now = new Date().toISOString();
  const { error: claimError } = await db.from("kv_store").insert({
    key,
    data: { status: "sending", asId, asNumber: as.as_number, createdAt: now },
    updated_at: now,
  });
  if (claimError) {
    if (claimError.code === "23505") return { ok: false, skipped: "already_notified" };
    return { ok: false, error: `claim_failed:${claimError.message}` };
  }

  const release = async () => { await db.from("kv_store").delete().eq("key", key); };

  try {
    let via: "thread" | "sms" | null = null;
    let smsAlso = false;

    if (as.cs_thread_id) {
      const threadData = await getThread(as.cs_thread_id);
      const channel = threadData?.thread.channel;
      if (threadData && channel) {
        const isPublic = PUBLIC_CHANNELS.includes(channel);
        const body = buildMessage(as, !isPublic);
        const res = await sendReply(as.cs_thread_id, body, {
          sentVia: "as_shipped_auto",
          rawExtra: { as_id: as.id, as_number: as.as_number },
        });
        if (res.ok) {
          via = "thread";
          // sendReply 는 답장 후 스레드를 waiting 으로 되돌린다 — 발송완료 안내는 대화의 끝이므로 닫는다.
          await db.from("cs_threads").update({ status: "resolved", updated_at: new Date().toISOString() })
            .eq("id", as.cs_thread_id);
          // 공개 채널엔 등기번호를 못 썼으니 SMS 로 따로 보낸다.
          if (isPublic && as.return_tracking_no) smsAlso = true;
        }
      }
    }

    if (via !== "thread" || smsAlso) {
      const phone = normalizePhone(as.customer_phone);
      const cfg = smsConfigured();
      if (phone && cfg.ok) {
        const text = buildSmsText(as);
        const outcome = await sendMany([{ to: phone, text, subject: `${BRAND_LABEL[as.brand ?? "paulvice"]} AS 발송 안내` }]);
        try {
          await logSmsSend({
            messageText: text,
            messageType: detectMessageType(text),
            sourceDesc: `AS 발송완료 안내 · ${as.as_number ?? as.id}`,
            recipientCount: 1,
            successCount: outcome.successCount,
            failCount: outcome.failCount,
            estCost: estimateCost(text, 1),
            groupId: outcome.groupId,
            results: outcome.results.map((r) => ({ ...r, name: as.customer_name ?? "", text: r.text ?? text })),
            isTest: false,
          });
        } catch (e) {
          console.error("[as-shipped] SMS 이력 기록 실패:", e instanceof Error ? e.message : String(e));
        }
        if (outcome.ok && via !== "thread") via = "sms";
        if (!outcome.ok && via !== "thread") {
          await release();
          return { ok: false, error: outcome.error ?? "sms_send_failed" };
        }
      } else if (via !== "thread") {
        // 보낼 수단이 없다 — 조용히 넘기면 또 손으로 챙겨야 하니 사장님께 알린다.
        await db.from("kv_store").update({
          data: { status: "manual", asId, asNumber: as.as_number, reason: phone ? "sms_not_configured" : "no_phone" },
          updated_at: new Date().toISOString(),
        }).eq("key", key);
        await notifyBoss(as, phone ? "SMS 설정이 없어" : "연락처가 없어");
        return { ok: false, skipped: phone ? "sms_not_configured" : "no_contact" };
      }
    }

    await db.from("kv_store").update({
      data: { status: "sent", asId, asNumber: as.as_number, via, sentAt: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }).eq("key", key);

    // 사장님이 "나갔구나" 를 알아야 중복으로 문자를 보내지 않는다.
    await sendTelegramMessage(
      `📦 AS 발송 안내 자동 발송\n\n${as.customer_name ?? "-"}님 · ${as.model ?? "-"}` +
        `${as.as_number ? ` (${as.as_number})` : ""}\n` +
        `${as.return_tracking_no ? `등기 ${as.return_tracking_no}\n` : ""}` +
        `경로: ${via === "thread" ? "CS 대화" : "문자"}${via === "thread" ? " · 스레드 종료됨" : ""}`
    ).catch(() => {});

    return { ok: true, via: via ?? undefined };
  } catch (e) {
    await release();
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
 * 미통보 스위퍼 — AS 상태를 shipped 로 바꾸는 경로가 둘(배포서버 as-ship 라우트,
 * 아이맥 asPaymentWatch.js)이라 한쪽에 훅을 걸어도 새는 건이 생긴다. 여기서 회수한다.
 * notifyAsShipped 가 자체 선점 가드를 가지므로 후보만 순회하면 안전하다.
 */
export async function sweepAsShippedNotifications(): Promise<{ checked: number; sent: number }> {
  const db = getCsSupabase();
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: rows } = await db
    .from("as_requests")
    .select("id")
    .eq("status", "shipped")
    .gte("shipped_at", since)
    .limit(50);
  let sent = 0;
  for (const r of rows ?? []) {
    try {
      const res = await notifyAsShipped(r.id as string);
      if (res.ok) sent++;
    } catch { /* 개별 실패 무시 — 다음 회차에서 재시도 */ }
  }
  return { checked: (rows ?? []).length, sent };
}
