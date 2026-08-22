/**
 * 설월 대기명단 수집 — 인트로 페이지(harriotwatches.co.kr / .com 의 /seolwol/intro.html)에서 호출.
 *
 * 카페24에 올라간 정적 HTML 이 크로스오리진으로 부르기 때문에 CORS 가 생명이다.
 * 허용목록은 lib/storefrontOrigin.ts 단일 소스 — 새 몰 도메인은 거기에만 추가한다.
 */
import { NextRequest, NextResponse } from "next/server";
import { addWaitlistEntry, WaitlistMall, waitlistSummary } from "@/lib/harriot/waitlist";
import { storefrontCorsHeaders } from "@/lib/storefrontOrigin";
import { sendTelegramMessage } from "@/lib/cs/telegram";

export const runtime = "nodejs";

function envAllow(): string[] {
  return (process.env.WEBCHAT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: storefrontCorsHeaders(req.headers.get("origin"), envAllow()) });
}

export async function POST(req: NextRequest) {
  const cors = storefrontCorsHeaders(req.headers.get("origin"), envAllow());
  try {
    const body = await req.json();
    const mall: WaitlistMall = body?.mall === "en" ? "en" : "kr";

    const result = await addWaitlistEntry({
      mall,
      contact: String(body?.contact ?? ""),
      consentPrivacy: !!body?.consentPrivacy,
      consentMarketing: !!body?.consentMarketing,
      utmSource: body?.utmSource ?? null,
      utmMedium: body?.utmMedium ?? null,
      utmCampaign: body?.utmCampaign ?? null,
      referrer: body?.referrer ?? null,
    });

    if (!result.ok) {
      // 실패 사유는 프런트에서 문구를 갈라 쓴다(동의 누락 vs 형식 오류).
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 400, headers: cors });
    }
    // 신규 등록만 알린다(중복 재등록은 알림 가치가 없다).
    // 알림 실패가 등록 성공을 뒤집으면 안 되므로 await 하되 예외는 삼킨다.
    if (!result.duplicate) {
      try {
        const s = await waitlistSummary();
        const masked =
          mall === "kr"
            ? String(body?.contact ?? "").replace(/\D/g, "").replace(/^(\d{3})\d+(\d{4})$/, "$1****$2")
            : String(body?.contact ?? "").trim().toLowerCase().replace(/^(.).*(@.*)$/, "$1***$2");
        const src = body?.utmSource ? ` · ${body.utmSource}` : "";
        await sendTelegramMessage(
          `🌙 <b>설월 대기명단 +1</b>\n` +
            `${mall === "kr" ? "국내" : "해외"} ${masked}${src}\n` +
            `누적 <b>${s.total}</b>명 (국내 ${s.kr} · 해외 ${s.en})`,
        );
      } catch (e) {
        console.warn("[harriot/waitlist] 텔레그램 알림 실패(등록은 성공)", e);
      }
    }

    return NextResponse.json({ ok: true, duplicate: result.duplicate }, { headers: cors });
  } catch (e) {
    console.error("[harriot/waitlist] 저장 실패", e);
    // 고객에겐 내부 사정을 노출하지 않되, 성공으로 속이지도 않는다.
    return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500, headers: cors });
  }
}
