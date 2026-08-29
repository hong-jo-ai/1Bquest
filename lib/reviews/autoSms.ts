/**
 * 국내(harriot_kr) 배송완료 주문 → 리뷰요청 문자 자동발송 — 공용 로직.
 * 관리자 라우트(/api/reviews/auto-sms)와 일일 크론(/api/cron/review-sms-kr)이 공유.
 */
import { reviewsDb, getMall, kakaoReviewConfig, type MallId } from "./core";
import { cafe24Get } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { sendReviewSmsBatch, type SmsTarget, type SmsCampaignResult } from "./sms";

// cafe24 표준 order_status: N40=배송완료(N30=배송중). 환경변수로 덮어쓰기 가능.
const DELIVERED = (process.env.REVIEW_SMS_DELIVERED_STATUS || "N40").toUpperCase();

/**
 * 같은 주문에 리뷰요청을 몇 번까지 시도할지.
 * 전에는 **성공했을 때만** 로그를 남겨서, 접수 단계에서 실패하면(Solapi 1026)
 * 다음 날 다시 대상이 됐다 — 실측으로 같은 번호에 12회·9회가 나갔다.
 * 실패도 기록하고 3회에서 포기한다. 일시적 장애는 두 번의 재시도로 충분하고,
 * 그 이상 실패하는 번호는 몇 번을 더 보내도 안 간다.
 */
const MAX_ATTEMPTS = 3;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 최근 days 일 배송완료(N40) 주문 중 미발송분 → SMS 타깃. statusDist는 진단용(실주문 status 분포). */
export async function collectDeliveredTargets(
  mallId: MallId,
  days: number,
  delayDays = 0,
): Promise<{ targets: SmsTarget[]; scanned: number; alreadySent: number; statusDist: Record<string, number>; priorAttempts: Map<string, number> }> {
  const mall = getMall(mallId)!;
  const at = await getAccessTokenFromStore(mall.cafe24Mall);
  if (!at) throw new Error("cafe24 토큰 없음");

  // 배송완료 직후가 아니라 며칠 뒤(고객이 써본 뒤) 발송 — 결제일 기준 delayDays 지난 주문만 대상.
  // (익일배송 기준 ≈ 배송완료 +(delayDays-1)일 뒤. 결제일 프록시라 각인 등 지연배송 건은 더 이르게 갈 수 있음.)
  const end = new Date(Date.now() - delayDays * 86400_000);
  const start = new Date(end.getTime() - days * 86400_000);
  const sb = reviewsDb();
  // ⚠️ channel 로 거르지 않는다. 예전엔 실제 발송수단과 무관하게 "sms" 로 박아 넣었고,
  //    이제 알림톡은 "kakao" 로 남기기 때문에 채널을 걸면 새 기록을 못 보고 재발송한다.
  const { data: sent } = await sb.from("review_request_log")
    .select("email,status,attempts").eq("mall", mallId);
  const prior = new Map<string, { status: string; attempts: number }>();
  for (const r of (sent || []) as Array<{ email: string; status: string | null; attempts: number | null }>) {
    prior.set(String(r.email), { status: r.status ?? "sent", attempts: r.attempts ?? 1 });
  }
  /** 보냈거나, 실패를 이미 여러 번 겪은 주문은 다시 시도하지 않는다. */
  const done = (orderId: string) => {
    const p = prior.get(orderId);
    return !!p && (p.status === "sent" || p.attempts >= MAX_ATTEMPTS);
  };

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
      if (done(orderId)) { alreadySent++; continue; }
      const recv = (o.receivers ?? [])[0] || {};
      const phone = String(recv.cellphone || recv.phone || o.cellphone || "").trim();
      if (phone.replace(/\D/g, "").length < 10) continue;
      // 050 안심번호는 카톡 사용자가 아니라 알림톡이 무조건 실패하고, SMS 대체발송도
      // 결번으로 튕긴다(실측 30일 10건 전부 실패). 보내봐야 버려지는 발송이라 제외.
      if (/^050/.test(phone.replace(/\D/g, ""))) continue;
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
  return { targets, scanned, alreadySent, statusDist, priorAttempts: new Map([...prior].map(([k, v]) => [k, v.attempts])) };
}

/** 배송완료분 리뷰요청 문자 발송 + 멱등 로그. */
export async function runAutoSms(
  mallId: MallId,
  opts: { days?: number; limit?: number; delayDays?: number } = {},
): Promise<SmsCampaignResult & { mode: "live"; mall: MallId }> {
  const days = Math.min(60, Math.max(1, opts.days || 14));
  // 발송 딜레이(결제 후 N일 뒤 = 고객이 받아서 써본 뒤). 기본 5일, env REVIEW_SMS_DELAY_DAYS 로 조정.
  const delayDays = Math.max(0, opts.delayDays ?? (Number(process.env.REVIEW_SMS_DELAY_DAYS ?? 5) || 0));
  const { targets, priorAttempts } = await collectDeliveredTargets(mallId, days, delayDays);
  const limited = opts.limit ? targets.slice(0, opts.limit) : targets;
  if (limited.length === 0) {
    return { ok: true, total: 0, successCount: 0, failCount: 0, type: "LMS", estCost: 0, results: [], mode: "live", mall: mallId };
  }
  const out = await sendReviewSmsBatch(limited);

  // 성공도 실패도 남긴다. 실패를 안 남기면 다음 날 같은 주문이 또 대상이 된다.
  const sb = reviewsDb();
  const failed = new Map<string, string>();
  for (const r of out.results) {
    if (r.status === "fail") failed.set(r.phone.replace(/\D/g, ""), r.error ?? "발송 실패");
  }
  // 실제 발송수단을 기록한다. 예전엔 알림톡으로 나가면서도 로그엔 "sms" 라 적혀 있어
  // 나중에 성과를 볼 때 채널을 오해하게 돼 있었다.
  const channel = kakaoReviewConfig(getMall(mallId)!) ? "kakao" : "sms";
  const rows = limited.map((t) => {
    const err = failed.get(t.phone.replace(/\D/g, ""));
    const before = priorAttempts.get(String(t.order_ref ?? "")) ?? 0;
    return {
      mall: mallId, email: String(t.order_ref ?? ""), channel,
      status: err ? "failed" : "sent",
      attempts: before + 1,
      last_error: err ?? null,
      sent_at: new Date().toISOString(),
    };
  });
  if (rows.length) await sb.from("review_request_log").upsert(rows, { onConflict: "mall,email" });

  return { ...out, mode: "live", mall: mallId };
}
