/**
 * 자사몰 '담기' 이벤트 수집 — 스킨 스크립트가 교차출처로 POST.
 * 공개 엔드포인트(proxy ALLOW_PREFIX). 로그인 회원만 의미있음(member_id 필수).
 */
import { ingestCartEvent, isCrmMall } from "@/lib/crm/cartStore";

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
      mall?: unknown; memberId?: unknown; productNo?: unknown; productName?: unknown; quantity?: unknown;
      campaignCode?: unknown;
    };
    // 캠페인 유입(문자 링크)이면 비로그인이어도 받는다 — 사람 식별이 코드로 되기 때문.
    const campaignCode = typeof b.campaignCode === "string" && b.campaignCode ? b.campaignCode : null;
    if (!isCrmMall(b.mall) || (!b.memberId && !campaignCode)) {
      return Response.json({ ok: false, error: "mall + (memberId | campaignCode) required" }, { status: 400, headers });
    }
    if (campaignCode) {
      // 캠페인 퍼널의 '장바구니' 단계. 실패해도 담기 수집 자체는 계속 간다.
      try { const { markCart } = await import("@/lib/crm/campaign"); await markCart(campaignCode); }
      catch (e) { console.error("[crm] markCart 실패:", e instanceof Error ? e.message : e); }
    }
    if (!b.memberId) return Response.json({ ok: true, campaignOnly: true }, { headers });
    const r = await ingestCartEvent({
      mall: b.mall,
      memberId: String(b.memberId).slice(0, 100),
      productNo: b.productNo != null && b.productNo !== "" ? Number(b.productNo) : null,
      productName: b.productName ? String(b.productName).slice(0, 200) : null,
      quantity: b.quantity != null ? Math.max(1, Number(b.quantity) || 1) : 1,
    });
    return Response.json({ ok: true, ...r }, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500, headers });
  }
}
