/**
 * 캠페인 짧은 링크 /c/<code> — 문자에 넣는 1인 1코드 링크.
 *
 * 하는 일 세 가지:
 *   1) 클릭 기록(누가 눌렀는지 확정)
 *   2) 랜딩 URL 에 `?pvc=<code>` 를 붙여 넘김 → pv-cart.js 가 이를 자사몰 localStorage 에 저장해
 *      이후 장바구니 담기까지 같은 사람으로 이어붙인다
 *   3) 상품 페이지로 리다이렉트
 *
 * ⚠️ 쿠키로 넘기지 않는 이유: 이 라우트는 대시보드 도메인(vercel.app)이고 쇼핑몰은
 *    paulvice.co.kr 이라 서로 쿠키를 못 읽는다. 크로스도메인은 URL 파라미터가 유일하게 확실하다.
 *
 * 공개 경로(로그인 불필요) — proxy.ts ALLOW_PREFIX 에 "/c/" 추가 필요.
 * 코드가 없거나 만료면 캠페인 랜딩 대신 자사몰 홈으로 보낸다(죽은 링크로 이탈시키지 않음).
 */
import { markClicked, getCampaign } from "@/lib/crm/campaign";

export const dynamic = "force-dynamic";

const HOME = "https://paulvice.co.kr";

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let url = HOME;
  try {
    const t = await markClicked(code);
    if (t) {
      const c = await getCampaign(t.campaign_id);
      if (c?.landingUrl) url = c.landingUrl;
    }
  } catch { /* 추적 실패가 고객 이동을 막으면 안 된다 — 홈으로라도 보낸다 */ }

  const sep = url.includes("?") ? "&" : "?";
  return new Response(null, {
    status: 302,
    headers: { Location: `${url}${sep}pvc=${encodeURIComponent(code)}`, "Cache-Control": "no-store" },
  });
}
