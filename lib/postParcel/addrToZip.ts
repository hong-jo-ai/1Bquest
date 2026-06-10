/**
 * 주소 문자열 → 우편번호(5자리) 자동 조회.
 * 행정안전부 도로명주소 API(juso.go.kr). JUSO_CONFM_KEY(무료 승인키) 필요 — 없으면 null.
 * 상세주소(동/호)가 붙어 매칭 실패하면 점차 뒤를 잘라 재시도한다.
 */
const JUSO_API = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

async function lookupOnce(keyword: string, key: string): Promise<string | null> {
  const url =
    `${JUSO_API}?` +
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
    const json = (await res.json().catch(() => null)) as
      | { results?: { juso?: Array<{ zipNo?: string }> } }
      | null;
    const zip = json?.results?.juso?.[0]?.zipNo;
    return zip && /^\d{5}$/.test(zip) ? zip : null;
  } catch {
    return null;
  }
}

/** 주소 → 우편번호. 키 미설정/조회 실패 시 null. */
export async function addrToZip(address: string): Promise<string | null> {
  const key = process.env.JUSO_CONFM_KEY;
  const base = (address ?? "").trim();
  if (!key || !base) return null;

  // 전체 → 마지막 토큰 제거 순으로 최대 3회(상세주소가 매칭 방해할 수 있어 점진 축약)
  const tokens = base.split(/\s+/);
  for (let drop = 0; drop <= 2 && tokens.length - drop >= 2; drop++) {
    const keyword = tokens.slice(0, tokens.length - drop).join(" ");
    const zip = await lookupOnce(keyword, key);
    if (zip) return zip;
  }
  return null;
}
