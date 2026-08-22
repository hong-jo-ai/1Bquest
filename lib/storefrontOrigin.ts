/**
 * 스토어프론트 → 대시보드 API 호출의 CORS 허용 도메인 (단일 소스).
 *
 * ⚠️ 목록이 두 벌이 되면 반드시 한쪽이 낡는다. 2026-08-05 에 영문몰 2개와
 *    harriotwatches.co.kr 이 통째로 빠져서 "버튼은 눌리는데 전송만 조용히 실패하는"
 *    무증상 장애가 났다. 그래서 웹챗·대기명단 등 **모든 스토어프론트 API 가 이 파일 하나를 본다.**
 *    새 몰 도메인이 생기면 여기에만 추가하면 된다.
 */

// 우리 소유 도메인은 **자기 자신과 모든 서브도메인**을 허용한다.
// (www·m 같은 걸 일일이 나열하면 계속 샌다)
export const STOREFRONT_BASE_DOMAINS = [
  // 폴바이스 — 국내(shop_no=1) · 영문(shop_no=2)
  "paulvice.co.kr",
  "paulvice.kr",
  // 해리엇 — 국내(shop_no=1)
  "harriot.co.kr",
  "harriotwatches.co.kr",
  // 해리엇 글로벌 영문몰(shop_no=2)
  "harriotwatches.com",
];

// 카페24 기본 도메인은 우리 것만 정확히 일치할 때 허용한다.
// (*.cafe24.com 을 통째로 열면 남의 쇼핑몰 전부가 우리 API 를 부를 수 있다)
export const STOREFRONT_EXACT_HOSTS = [
  "paulvice.cafe24.com",
  "harriotkorea.cafe24.com",
];

export const DEFAULT_STOREFRONT_ORIGIN = "https://paulvice.co.kr";

export function isAllowedStorefrontOrigin(origin: string, envAllowList: string[] = []): boolean {
  // 환경변수로 지정했으면 그 목록만 쓴다(정확 일치).
  if (envAllowList.length > 0) return envAllowList.includes(origin);

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();

  if (STOREFRONT_EXACT_HOSTS.includes(host)) return true;
  // endsWith 만 쓰면 evil-paulvice.co.kr 같은 도메인이 통과한다 — 점 경계까지 확인.
  return STOREFRONT_BASE_DOMAINS.some((base) => host === base || host.endsWith(`.${base}`));
}

/** 프리플라이트·응답 공통 CORS 헤더. 허용되지 않은 origin 은 기본 도메인으로 떨어뜨린다. */
export function storefrontCorsHeaders(origin: string | null, envAllowList: string[] = []) {
  const allow =
    origin && isAllowedStorefrontOrigin(origin, envAllowList)
      ? origin
      : (envAllowList[0] ?? DEFAULT_STOREFRONT_ORIGIN);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
