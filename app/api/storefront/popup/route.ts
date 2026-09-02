/**
 * 스토어프론트 팝업 설정·이벤트 — 스토어프론트 스크립트가 교차출처로 호출.
 *
 * GET  → 설정(킬스위치·임계값). 스크립트가 매 페이지에서 읽으므로 가볍게 유지한다.
 * POST → 노출·클릭·닫기 기록.
 *
 * 공개 엔드포인트다. 설정에는 비밀이 없고, 이벤트는 익명ID만 받는다.
 */
import { getConfig, recordEvent } from "@/lib/storefront/popup";
import { isAllowedStorefrontOrigin, DEFAULT_STOREFRONT_ORIGIN } from "@/lib/storefrontOrigin";

export const dynamic = "force-dynamic";

// 허용 도메인은 lib/storefrontOrigin.ts 하나만 본다 — 목록이 두 벌이면 한쪽이 낡는다.
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": isAllowedStorefrontOrigin(origin) ? origin : DEFAULT_STOREFRONT_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: cors(req) }); }

export async function GET(req: Request) {
  const headers = { ...cors(req), "Cache-Control": "public, max-age=300" };
  return Response.json(await getConfig(), { headers });
}

export async function POST(req: Request) {
  const headers = cors(req);
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ev = String(b.event ?? "");
    if (!["eligible", "shown", "click", "dismiss"].includes(ev)) {
      return Response.json({ ok: false, error: "bad event" }, { status: 400, headers });
    }
    await recordEvent({
      mall: String(b.mall ?? "paulvice"),
      popup: String(b.popup ?? "hesitation"),
      anonId: typeof b.anonId === "string" && /^[a-z0-9-]{8,64}$/i.test(b.anonId) ? b.anonId : null,
      memberId: b.memberId ? String(b.memberId).slice(0, 100) : null,
      productNo: b.productNo != null ? Number(b.productNo) || null : null,
      event: ev as "eligible" | "shown" | "click" | "dismiss",
      holdout: !!b.holdout,
      path: b.path ? String(b.path) : null,
    });
    return Response.json({ ok: true }, { headers });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500, headers });
  }
}
