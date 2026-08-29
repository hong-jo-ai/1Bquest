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

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://paulvice.co.kr", "https://www.paulvice.co.kr", "https://m.paulvice.co.kr", "https://paulvice.cafe24.com",
  "https://harriot.co.kr", "https://www.harriot.co.kr", "https://m.harriot.co.kr", "https://harriotkorea.cafe24.com",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
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
      quantity?: unknown; campaignCode?: unknown; type?: unknown; orderId?: unknown;
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
    });
    return Response.json({ ok: true, ...r }, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500, headers });
  }
}
