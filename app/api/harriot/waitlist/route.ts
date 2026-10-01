/**
 * 설월 대기명단 수집 — 인트로 페이지(harriotwatches.co.kr / .com 의 /seolwol/intro.html)에서 호출.
 *
 * 카페24에 올라간 정적 HTML 이 크로스오리진으로 부르기 때문에 CORS 가 생명이다.
 * 허용목록은 lib/storefrontOrigin.ts 단일 소스 — 새 몰 도메인은 거기에만 추가한다.
 *
 * 명단이 두 개다(2026-10-01):
 *   - 요청에 `list` 가 없으면 → **출시 대기명단**(기존 동작 그대로, KV harriot:seolwol:waitlist:v1)
 *   - `list:"restock"`       → **재입고 신청 명단**(KV harriot:seolwol:restock:v1, lib/harriot/restockList.ts)
 *     품절된 설월 상세의 주입 스크립트(public/hrt-soldout.js)가 부른다.
 */
import { NextRequest, NextResponse } from "next/server";
import { addWaitlistEntry, WaitlistMall, waitlistSummary } from "@/lib/harriot/waitlist";
import { addRestockRequest } from "@/lib/harriot/restockList";
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

    // 재입고 신청은 별도 명단으로. 아래 출시 대기명단 경로는 건드리지 않는다.
    if (body?.list === "restock") {
      return await handleRestock(body, mall, cors);
    }

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

/** 재입고 신청 — 응답 모양은 출시 대기명단과 같다({ ok, duplicate } / { ok:false, reason }). */
async function handleRestock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  mall: WaitlistMall,
  cors: Record<string, string>,
) {
  const result = await addRestockRequest({
    productNo: body?.productNo,
    mall,
    contact: String(body?.contact ?? ""),
    consentPrivacy: !!body?.consentPrivacy,
    utmSource: body?.utmSource,
    utmMedium: body?.utmMedium,
    utmCampaign: body?.utmCampaign,
    utmContent: body?.utmContent,
    referrer: body?.referrer,
    page: body?.page,
  });

  if (!result.ok) {
    // 명단이 가득 찬 건 고객 잘못이 아니다 — 서버 오류로 돌려주고 우리가 알아챈다.
    if (result.reason === "list_full") {
      console.error("[harriot/waitlist] 재입고 명단 상한 도달 — 신청을 못 받았다");
      return NextResponse.json({ ok: false, reason: "server_error" }, { status: 500, headers: cors });
    }
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400, headers: cors });
  }

  if (!result.duplicate) {
    try {
      const contact = String(body?.contact ?? "");
      const masked =
        mall === "kr"
          ? contact.replace(/\D/g, "").replace(/^(\d{3})\d+(\d{4})$/, "$1****$2")
          : contact.trim().toLowerCase().replace(/^(.).*(@.*)$/, "$1***$2");
      const src = typeof body?.utmSource === "string" && body.utmSource ? ` · ${body.utmSource.slice(0, 40)}` : "";
      await sendTelegramMessage(
        `🔔 <b>설월 재입고 신청 +1</b>\n` +
          `${mall === "kr" ? "국내" : "해외"} ${escapeHtml(masked)}${escapeHtml(src)}\n` +
          `누적 <b>${result.total}</b>명`,
      );
    } catch (e) {
      console.warn("[harriot/waitlist] 텔레그램 알림 실패(재입고 신청은 성공)", e);
    }
  }

  return NextResponse.json({ ok: true, duplicate: result.duplicate }, { headers: cors });
}

/** 텔레그램 parse_mode=HTML — 익명 입력이 섞이므로 꺾쇠를 막는다. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
