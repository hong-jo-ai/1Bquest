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
import { register, consumeSession, assignSerial, serialsLeft, detectChannel, digits, isMobile } from "@/lib/care/store";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/** 시리얼 풀이 비었을 때만 쓰는 폴백 안내 문구 — 실제 쿠폰 코드는 care_coupon_serials 에서 배정한다. */
const SERIAL_LOW_ALERT = 50;

/**
 * 카드 배포 개시(care:config:v1.cardStartDate) 이후 **첫 등록**인지.
 *
 * 왜 따로 보나: 첫 등록은 숫자가 아니라 **카드가 실제로 작동한다는 신호**다.
 * QR 이 찍히는지, 랜딩이 뜨는지, 인증이 되는지가 그 한 건으로 증명된다.
 * (배포 전 테스트 등록이 이미 있어 전체 건수로는 판별할 수 없다 — 개시일 기준으로 센다.)
 * 실패해도 등록 자체를 막지 않는다.
 */
async function isFirstSinceCards(): Promise<boolean> {
  try {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return false;
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data: cfg } = await sb.from("kv_store").select("data").eq("key", "care:config:v1").maybeSingle();
    const since = (cfg?.data as { cardStartDate?: string } | null)?.cardStartDate;
    if (!since) return false;
    const { count } = await sb.from("care_registrations")
      .select("phone", { count: "exact", head: true }).gte("registered_at", since);
    return count === 1;
  } catch { return false; }
}

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
    // 1인 1코드 배정(재등록이면 기존 코드 반환). 풀이 비면 null 이어도 등록은 계속 간다.
    const coupon = await assignSerial(phone);
    // 카드는 전 주문에 동봉되므로 QR 파라미터로는 채널 구분이 안 된다 → 발송기록으로 역추적.
    const channel = await detectChannel(phone).catch(() => null);
    const rec = await register({
      phone,
      product_no: b.productNo ?? null,
      product_name: b.productName ?? null,
      product_other: b.productOther ?? null,
      ad_consent: !!b.adConsent,
      source: [b.source, channel].filter(Boolean).join("/") || null,
      coupon_code: coupon,
    });
    // 등록은 드물게 일어나는 이벤트라 실시간으로 알린다(초기엔 반응을 봐야 한다).
    const first = await isFirstSinceCards();
    const head = first
      ? "🎉 <b>CARE 첫 등록</b> — 카드가 작동합니다\n<i>QR·랜딩·본인확인까지 한 바퀴 다 돌았습니다.</i>\n"
      : "🩺 <b>PAULVICE CARE 등록</b>\n";
    sendTelegramMessage(
      `${head}${phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")} · ${b.productName || b.productOther || "제품미상"}\n광고수신 ${b.adConsent ? "동의" : "미동의"} · 구매채널 ${channel ?? "미확인"}${coupon ? ` · 쿠폰 ${coupon}` : " · ⚠️쿠폰 미배정"}`,
    ).catch(() => {});
    // 시리얼 소진 경보 — 다 떨어진 뒤 알면 늦다.
    const left = await serialsLeft().catch(() => -1);
    if (left >= 0 && (left === 0 || left === SERIAL_LOW_ALERT)) {
      sendTelegramMessage(
        left === 0
          ? "🔴 <b>CARE 스트랩 쿠폰 시리얼 소진</b>\n관리자에서 추가 발급 후 CSV 를 넘겨주세요. 지금은 쿠폰 없이 등록만 됩니다."
          : `⚠️ <b>CARE 쿠폰 시리얼 ${left}장 남음</b>\n여유 있을 때 추가 발급해 두세요.`,
      ).catch(() => {});
    }
    return Response.json({ ok: true, coupon, registered: !!rec }, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500, headers });
  }
}
