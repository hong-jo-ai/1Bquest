/**
 * CARE 등록 — 본인확인·제품선택·동의를 받아 저장하고 스트랩 쿠폰을 발급한다.
 *
 * POST /api/care/register
 *   { phone, token, productNo?, productName?, productOther?, adConsent, source? }
 *
 * ⚠️ 본인확인 세션 토큰을 여기서 검증한다. 프론트만 믿으면 API 를 직접 때려
 *    남의 번호로 등록할 수 있다. 인증번호 자체는 검증 단계에서 이미 소모되므로
 *    토큰으로 이어받는다(초기 버전이 인증번호를 다시 요구해 등록이 전부 실패했다).
 * ⚠️ 광고 수신동의(adConsent)는 **선택**이다. 미동의여도 등록은 정상 처리한다 —
 *    동의를 강제하면 그 동의 자체가 무효가 된다.
 */
import { type NextRequest } from "next/server";
import { register, consumeSession, digits, isMobile } from "@/lib/care/store";
import { sendTelegramMessage } from "@/lib/cs/telegram";

export const dynamic = "force-dynamic";

/** 스트랩 할인 쿠폰 — 카페24 쿠폰 발급 API 연동 전까지는 고정 코드로 운영한다. */
const STRAP_COUPON = process.env.CARE_STRAP_COUPON || "CARE-STRAP";

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: cors(req) }); }

export async function POST(req: NextRequest) {
  const headers = cors(req);
  const b = (await req.json().catch(() => ({}))) as {
    phone?: string; token?: string; productNo?: number; productName?: string;
    productOther?: string; adConsent?: boolean; source?: string;
  };
  const phone = digits(b.phone);
  if (!isMobile(phone)) return Response.json({ ok: false, error: "휴대폰 번호를 확인해 주세요" }, { status: 400, headers });

  const ok = await consumeSession(phone, String(b.token ?? ""));
  if (!ok) return Response.json({ ok: false, error: "본인확인이 만료되었습니다. 처음부터 다시 진행해 주세요" }, { status: 401, headers });

  if (!b.productNo && !b.productOther) {
    return Response.json({ ok: false, error: "제품을 선택해 주세요" }, { status: 400, headers });
  }

  try {
    const rec = await register({
      phone,
      product_no: b.productNo ?? null,
      product_name: b.productName ?? null,
      product_other: b.productOther ?? null,
      ad_consent: !!b.adConsent,
      source: b.source ?? null,
      coupon_code: STRAP_COUPON,
    });
    // 등록은 드물게 일어나는 이벤트라 실시간으로 알린다(초기엔 반응을 봐야 한다).
    sendTelegramMessage(
      `🩺 <b>PAULVICE CARE 등록</b>\n${phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")} · ${b.productName || b.productOther || "제품미상"}\n광고수신 ${b.adConsent ? "동의" : "미동의"}${b.source ? ` · 유입 ${b.source}` : ""}`,
    ).catch(() => {});
    return Response.json({ ok: true, coupon: STRAP_COUPON, registered: !!rec }, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500, headers });
  }
}
