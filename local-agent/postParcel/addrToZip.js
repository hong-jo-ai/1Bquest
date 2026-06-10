/**
 * 주소 → 우편번호(5자리) 자동 조회 (워커/로컬용 CJS).
 * 행안부 도로명주소 검색 API(juso.go.kr). JUSO_CONFM_KEY 필요(워커가 .env.local 에서 로드).
 * 워커는 한국 IP + 검증된 운영키라, 배포(Vercel) 라우트의 환경/리전 변수를 우회한다.
 * 상세주소(동/호)가 매칭을 방해하면 뒤 토큰을 점진 제거하며 재시도.
 */
const JUSO_API = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

async function lookupOnce(keyword, key) {
  const url =
    JUSO_API +
    "?" +
    new URLSearchParams({
      confmKey: key,
      currentPage: "1",
      countPerPage: "1",
      keyword,
      resultType: "json",
    });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const common = j && j.results && j.results.common;
    if (common && common.errorCode && common.errorCode !== "0") return null;
    const zip = j && j.results && j.results.juso && j.results.juso[0] && j.results.juso[0].zipNo;
    return zip && /^\d{5}$/.test(zip) ? zip : null;
  } catch {
    return null;
  }
}

/** 주소 → 우편번호. 키 미설정/조회 실패 시 null. */
async function addrToZip(address) {
  const key = process.env.JUSO_CONFM_KEY;
  const base = (address || "").trim();
  if (!key || !base) return null;
  const tokens = base.split(/\s+/);
  for (let drop = 0; drop <= 2 && tokens.length - drop >= 2; drop++) {
    const zip = await lookupOnce(tokens.slice(0, tokens.length - drop).join(" "), key);
    if (zip) return zip;
  }
  return null;
}

module.exports = { addrToZip };
