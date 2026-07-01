/**
 * 국내 리뷰요청 일일 크론 — 배송완료 주문에 문자 발송 + 적립금 보상 지급.
 *
 * GET + Authorization: Bearer ${CRON_SECRET}  (Vercel cron)
 * POST ?manual=1                               (수동 트리거)
 *
 * 안전장치: REVIEW_SMS_AUTO_ENABLED 가 "1"/"true" 일 때만 실제 발송.
 * (카페24 적립금 스코프 재연결 + 테스트 발송 검증 전엔 끄두고 코드만 머지)
 */
import { runAutoSms } from "@/lib/reviews/autoSms";
import { payPendingRewards } from "@/lib/reviews/reward";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 국내 두 브랜드 모두 리뷰요청 — 해리엇 + 폴바이스. 한 몰 실패해도 다른 몰 진행.
const MALLS = ["harriot_kr", "paulvice_kr"] as const;

function autoEnabled(): boolean {
  const v = (process.env.REVIEW_SMS_AUTO_ENABLED || "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

async function run() {
  if (!autoEnabled()) {
    return Response.json({ ok: true, skipped: "REVIEW_SMS_AUTO_ENABLED 꺼짐 — 발송 안 함" });
  }
  const malls: Record<string, unknown> = {};
  for (const mall of MALLS) {
    try {
      // 1) 결제 후 딜레이(REVIEW_SMS_DELAY_DAYS, 기본 5일) 지난 배송완료분에 리뷰요청.
      //    window 14일 = 딜레이 지점 전후를 넉넉히 스캔(중복은 review_request_log로 방지).
      const sms = await runAutoSms(mall, { days: 14 });
      // 2) 그동안 작성된 리뷰의 적립금 보상 지급(회원 매칭분)
      const reward = await payPendingRewards(mall, 100);
      malls[mall] = { sms: { sent: sms.successCount, fail: sms.failCount, total: sms.total }, reward };
    } catch (e) {
      malls[mall] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return Response.json({ ok: true, malls });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try { return await run(); }
  catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

export async function POST() {
  try { return await run(); }
  catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
