/**
 * 상단 띠배너 설정 — 스토어프론트 스크립트가 교차출처로 호출한다.
 *
 * GET ?mall=paulvice|harriot → **지금 보여줄 항목 하나**(없으면 null).
 * 기간·몰 판정은 서버에서 끝낸다. 클라이언트에 규칙을 두면 브라우저 캐시에 낡은 규칙이 남아
 * "내렸는데 계속 보인다"가 된다.
 *
 * 공개 엔드포인트다. 설정에 비밀은 없다.
 */
import { noticeFor } from "@/lib/storefront/notice";
import { isAllowedStorefrontOrigin, DEFAULT_STOREFRONT_ORIGIN } from "@/lib/storefrontOrigin";

export const dynamic = "force-dynamic";

// 허용 도메인은 lib/storefrontOrigin.ts 하나만 본다 — 목록이 두 벌이면 한쪽이 낡는다.
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": isAllowedStorefrontOrigin(origin) ? origin : DEFAULT_STOREFRONT_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req) });
}

export async function GET(req: Request) {
  // ⚠️ 캐시를 길게 잡으면 급히 내려도 한참 남는다. 띠는 가벼우니 60초면 충분하다.
  const headers = { ...cors(req), "Cache-Control": "public, max-age=60" };
  try {
    const mall = new URL(req.url).searchParams.get("mall") === "harriot" ? "harriot" : "paulvice";
    // ⚠️ snoozeHours 도 같이 내려야 한다 — 스크립트가 닫기 후 재노출 간격에 쓴다.
    //    빠뜨리면 설정값이 조용히 무시되고 기본 24시간으로 떨어진다.
    const { notice, snoozeHours } = await noticeFor(mall);
    return Response.json({ ok: true, notice, snoozeHours }, { headers });
  } catch {
    // 페일오픈 — 실패해도 스크립트가 조용히 넘어가도록 200/null 로 답한다.
    return Response.json({ ok: false, notice: null, snoozeHours: 24 }, { headers });
  }
}
