/**
 * AS·문의 짧은 링크 — 외부 채널(무신사·29CM·W컨셉·카카오선물·조선몰) 안내에 인쇄해 쓰는 주소.
 *
 *   https://care.paulvice.co.kr/cs      → 폴바이스 자사몰 + 상담창 자동 열림
 *   https://care.paulvice.co.kr/cs/h    → 해리엇 자사몰 + 상담창 자동 열림
 *
 * 왜 리다이렉트인가: 웹챗 위젯은 자사몰 페이지에 붙어 있어서 그 페이지로 보내야 한다.
 * 그런데 `paulvice.co.kr/?pv_open=1` 은 카드·안내문에 찍기엔 길고 지저분하다.
 * 이 라우트가 짧은 주소를 받아 위젯 열기 파라미터를 붙여 넘긴다.
 *
 * 유입 경로 추적: `?s=musinsa` 처럼 붙이면 그대로 `pv_s` 로 넘겨 어느 채널에서
 * 들어온 문의인지 구분할 수 있다. 없으면 안 붙인다.
 *
 * 공개 경로(로그인 불필요) — proxy.ts ALLOW_PREFIX 에 "/cs" 등록 필요.
 */
export const dynamic = "force-dynamic";

const MALL: Record<string, string> = {
  paulvice: "https://paulvice.co.kr",
  harriot: "https://harriotwatches.co.kr",
};

/** `/cs/h`, `/cs/harriot`, `/cs/해리엇` 모두 해리엇으로 본다. 나머지는 폴바이스. */
function mallOf(slug: string[] | undefined): string {
  const first = (slug?.[0] ?? "").toLowerCase();
  return /^(h|harriot|해리엇)$/.test(first) ? MALL.harriot : MALL.paulvice;
}

export async function GET(req: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const src = new URL(req.url).searchParams.get("s") ?? "";

  const target = new URL(mallOf(slug));
  target.searchParams.set("pv_open", "1");
  // 유입 채널은 있을 때만 — 빈 값이 붙어 URL 이 지저분해지는 걸 막는다.
  if (src) target.searchParams.set("pv_s", src.slice(0, 24));

  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}
