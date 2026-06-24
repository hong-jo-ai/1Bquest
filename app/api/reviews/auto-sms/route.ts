import { type NextRequest } from "next/server";
import { type MallId } from "@/lib/reviews/core";
import { sendReviewSmsBatch, buildReviewSms, type SmsTarget } from "@/lib/reviews/sms";
import { collectDeliveredTargets, runAutoSms } from "@/lib/reviews/autoSms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 국내(harriot_kr) 배송완료 주문 → 리뷰요청 문자 자동발송.
 * 리뷰요청은 정보성 문자(거래 후속 안내)로 취급 — 수신거부번호 없이 발송 가능.
 *
 * 호출: GET ?dryRun(=대상 미리보기) · POST {mode:'test',testPhone} · POST {mode:'live',days?,limit?}
 */

function maskPhone(p: string): string {
  return p.replace(/\D/g, "").replace(/(\d{3})\d+(\d{4})/, "$1****$2");
}

export async function GET(req: NextRequest) {
  const mallId = (req.nextUrl.searchParams.get("mall") || "harriot_kr") as MallId;
  const days = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 14));
  try {
    const { targets, scanned, alreadySent, statusDist } = await collectDeliveredTargets(mallId, days);
    const base = process.env.REVIEW_BASE_URL || "https://paulvice-dashboard.vercel.app";
    const sample = targets[0] ? buildReviewSms(targets[0], `${base}/r/xxxxxxx`) : null;
    return Response.json({
      ok: true, mall: mallId, days, scanned, alreadySent, pending: targets.length, statusDist,
      sample,
      preview: targets.slice(0, 10).map((t) => ({ name: t.customer_name, phone: maskPhone(t.phone), product: t.product_name, order: t.order_ref })),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { mode?: "test" | "live"; testPhone?: string; mall?: string; days?: number; limit?: number };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const mallId = (body.mall || "harriot_kr") as MallId;

  // 테스트: 내 번호로 샘플 1통
  if (body.mode === "test") {
    if (!body.testPhone) return Response.json({ error: "testPhone 필요" }, { status: 400 });
    const t: SmsTarget = { mall: mallId, phone: body.testPhone, customer_name: "테스트", product_no: 124, product_name: "광안 로즈골드 블랙 여성시계", order_ref: "TEST" };
    const out = await sendReviewSmsBatch([t]);
    return Response.json({ mode: "test", ...out });
  }

  // 실발송: 배송완료 주문 대상
  try {
    const result = await runAutoSms(mallId, { days: body.days, limit: body.limit });
    return Response.json(result);
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
