/**
 * 국내(harriot_kr) 배송완료 주문 → 리뷰요청 문자 자동발송 — 공용 로직.
 * 관리자 라우트(/api/reviews/auto-sms)와 일일 크론(/api/cron/review-sms-kr)이 공유.
 */
import { reviewsDb, getMall, type MallId } from "./core";
import { cafe24Get } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { sendReviewSmsBatch, type SmsTarget, type SmsCampaignResult } from "./sms";

// cafe24 표준 order_status: N40=배송완료(N30=배송중). 환경변수로 덮어쓰기 가능.
const DELIVERED = (process.env.REVIEW_SMS_DELIVERED_STATUS || "N40").toUpperCase();

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 최근 days 일 배송완료(N40) 주문 중 미발송분 → SMS 타깃. statusDist는 진단용(실주문 status 분포). */
export async function collectDeliveredTargets(
  mallId: MallId,
  days: number,
  delayDays = 0,
): Promise<{ targets: SmsTarget[]; scanned: number; alreadySent: number; statusDist: Record<string, number> }> {
  const mall = getMall(mallId)!;
  const at = await getAccessTokenFromStore(mall.cafe24Mall);
  if (!at) throw new Error("cafe24 토큰 없음");

  // 배송완료 직후가 아니라 며칠 뒤(고객이 써본 뒤) 발송 — 결제일 기준 delayDays 지난 주문만 대상.
  // (익일배송 기준 ≈ 배송완료 +(delayDays-1)일 뒤. 결제일 프록시라 각인 등 지연배송 건은 더 이르게 갈 수 있음.)
  const end = new Date(Date.now() - delayDays * 86400_000);
  const start = new Date(end.getTime() - days * 86400_000);
  const sb = reviewsDb();
  const { data: sent } = await sb.from("review_request_log").select("email").eq("mall", mallId).eq("channel", "sms");
  const sentSet = new Set((sent || []).map((r) => String(r.email)));

  const targets: SmsTarget[] = [];
  const statusDist: Record<string, number> = {};
  let scanned = 0, alreadySent = 0, offset = 0;
  const seenOrder = new Set<string>();
  while (true) {
    const qs = new URLSearchParams({
      shop_no: String(mall.shopNo),
      start_date: ymd(start), end_date: ymd(end),
      date_type: "pay_date",
      embed: "items,receivers",
      limit: "100", offset: String(offset),
    });
    const data = await cafe24Get(`/api/v2/admin/orders?${qs}`, at, mall.cafe24Mall);
    const batch: any[] = data?.orders ?? [];
    for (const o of batch) {
      scanned++;
      const orderId = String(o.order_id ?? o.order_no ?? "");
      if (!orderId || seenOrder.has(orderId)) continue;
      seenOrder.add(orderId);
      const items: any[] = o.items ?? [];
      for (const it of items) { const s = String(it.order_status || "?").toUpperCase(); statusDist[s] = (statusDist[s] || 0) + 1; }
      const delivered = items.some((it) => String(it.order_status || "").toUpperCase() === DELIVERED);
      if (!delivered) continue;
      if (sentSet.has(orderId)) { alreadySent++; continue; }
      const recv = (o.receivers ?? [])[0] || {};
      const phone = String(recv.cellphone || recv.phone || o.cellphone || "").trim();
      if (phone.replace(/\D/g, "").length < 10) continue;
      const name = String(recv.name || o.buyer_name || o.member_id || "고객");
      const it0 = items.find((it) => String(it.order_status || "").toUpperCase() === DELIVERED) || items[0] || {};
      targets.push({
        mall: mallId,
        phone,
        customer_name: name,
        product_no: Number(it0.product_no) || null,
        product_name: it0.product_name || null,
        order_ref: orderId,
      });
    }
    if (batch.length < 100) break;
    offset += 100;
  }
  return { targets, scanned, alreadySent, statusDist };
}

/** 배송완료분 리뷰요청 문자 발송 + 멱등 로그. */
export async function runAutoSms(
  mallId: MallId,
  opts: { days?: number; limit?: number; delayDays?: number } = {},
): Promise<SmsCampaignResult & { mode: "live"; mall: MallId }> {
  const days = Math.min(60, Math.max(1, opts.days || 14));
  // 발송 딜레이(결제 후 N일 뒤 = 고객이 받아서 써본 뒤). 기본 5일, env REVIEW_SMS_DELAY_DAYS 로 조정.
  const delayDays = Math.max(0, opts.delayDays ?? (Number(process.env.REVIEW_SMS_DELAY_DAYS ?? 5) || 0));
  const { targets } = await collectDeliveredTargets(mallId, days, delayDays);
  const limited = opts.limit ? targets.slice(0, opts.limit) : targets;
  if (limited.length === 0) {
    return { ok: true, total: 0, successCount: 0, failCount: 0, type: "LMS", estCost: 0, results: [], mode: "live", mall: mallId };
  }
  const out = await sendReviewSmsBatch(limited);

  // 성공분만 로그(중복방지, 부분실패 허용).
  const sb = reviewsDb();
  const failedPhones = new Set(out.results.filter((r) => r.status === "fail").map((r) => r.phone.replace(/\D/g, "")));
  const rows = limited
    .filter((t) => !failedPhones.has(t.phone.replace(/\D/g, "")))
    .map((t) => ({ mall: mallId, email: t.order_ref, channel: "sms" }));
  if (rows.length) await sb.from("review_request_log").upsert(rows, { onConflict: "mall,email", ignoreDuplicates: true });

  return { ...out, mode: "live", mall: mallId };
}
