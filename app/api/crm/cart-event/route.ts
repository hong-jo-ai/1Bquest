/**
 * 자사몰 '담기'·'구매도달' 이벤트 수집 — 스토어프론트 스크립트가 교차출처로 POST.
 * 공개 엔드포인트(proxy ALLOW_PREFIX).
 *
 * 2026-08-30: **비로그인도 받는다.** 예전엔 member_id 가 있어야만 적재해서,
 * 최근 30일 주문의 47%를 차지하는 비회원 장바구니가 통째로 안 잡혔다
 * (2개월 수집량이 26건 — 하루 0.4건인데 주문은 하루 3~7건이었다).
 * 익명ID는 브라우저에 심은 임의 문자열이고 이름·연락처가 아니다.
 */
import { ingestCartEvent, markPurchased, isCrmMall } from "@/lib/crm/cartStore";
import { isAllowedStorefrontOrigin, DEFAULT_STOREFRONT_ORIGIN } from "@/lib/storefrontOrigin";

export const dynamic = "force-dynamic";

// ⚠️ 예전엔 이 파일이 허용 도메인 목록을 따로 갖고 있었다. 그래서 **영문몰(paulvice.kr /
//    harriotwatches.com)과 harriotwatches.co.kr 이 통째로 빠져** 그쪽 담기는 한 건도
//    기록되지 않았다 — 버튼은 눌리는데 전송만 조용히 실패하는 무증상 장애다.
//    허용 목록은 lib/storefrontOrigin.ts 하나만 본다(2026-08-05 웹챗 때와 같은 사고).
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = isAllowedStorefrontOrigin(origin) ? origin : DEFAULT_STOREFRONT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  const headers = corsHeaders(req);
  try {
    const b = (await req.json().catch(() => ({}))) as {
      mall?: unknown; memberId?: unknown; anonId?: unknown; productNo?: unknown; productName?: unknown;
      quantity?: unknown; campaignCode?: unknown; type?: unknown; orderId?: unknown; shopNo?: unknown;
    };
    const campaignCode = typeof b.campaignCode === "string" && b.campaignCode ? b.campaignCode : null;
    const memberId = b.memberId ? String(b.memberId).slice(0, 100) : null;
    const anonId = typeof b.anonId === "string" && /^[a-z0-9-]{8,64}$/i.test(b.anonId) ? b.anonId : null;
    if (!isCrmMall(b.mall) || (!memberId && !anonId && !campaignCode)) {
      return Response.json({ ok: false, error: "mall + (memberId | anonId | campaignCode) required" }, { status: 400, headers });
    }
    if (campaignCode) {
      // 캠페인 퍼널의 '장바구니' 단계. 실패해도 담기 수집 자체는 계속 간다.
      try { const { markCart } = await import("@/lib/crm/campaign"); await markCart(campaignCode); }
      catch (e) { console.error("[crm] markCart 실패:", e instanceof Error ? e.message : e); }
    }

    // 주문완료 페이지 도달 — 그 사람의 열린 담기를 전환으로 닫는다.
    if (b.type === "purchase") {
      const n = await markPurchased(b.mall, { memberId, anonId }, b.orderId ? String(b.orderId).slice(0, 64) : null);
      return Response.json({ ok: true, converted: n }, { headers });
    }

    if (!memberId && !anonId) return Response.json({ ok: true, campaignOnly: true }, { headers });
    const r = await ingestCartEvent({
      mall: b.mall,
      memberId, anonId,
      productNo: b.productNo != null && b.productNo !== "" ? Number(b.productNo) : null,
      productName: b.productName ? String(b.productName).slice(0, 200) : null,
      quantity: b.quantity != null ? Math.max(1, Number(b.quantity) || 1) : 1,
      shopNo: Number(b.shopNo) === 2 ? 2 : 1,
    });
    return Response.json({ ok: true, ...r }, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500, headers });
  }
}
