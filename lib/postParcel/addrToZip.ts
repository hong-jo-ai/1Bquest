/**
 * 주소 문자열 → 우편번호(5자리) 자동 조회.
 * 행정안전부 도로명주소 API(juso.go.kr). JUSO_CONFM_KEY(무료 승인키) 필요 — 없으면 null.
 *
 * juso 검색은 키워드가 조금만 어긋나도(상세주소·건물명·"대전시" 같은 약칭·옛 행정동) 결과가 0건이라
 * 후보 키워드를 여러 개 만들어 순서대로 시도한다. 대신 아무 결과나 받으면 엉뚱한 우편번호로
 * 오배송이 나므로 건물번호·도로명·시군구 일치를 검증하고, 못 맞추면 null 을 준다.
 * ⚠️ 워커(local-agent/postParcel/addrToZip.js)와 같은 로직 — 한쪽만 고치지 말 것.
 */
const JUSO_API = "https://business.juso.go.kr/addrlink/addrLinkApi.do";
const NUM = /^\d+(-\d+)?$/;
const ROAD = /(로|길)$/;
const CITY = /^(서울|부산|대구|인천|광주|대전|울산|세종)(시|특별시|광역시|특별자치시)$/;

type Juso = {
  zipNo?: string;
  siNm?: string;
  sggNm?: string;
  emdNm?: string;
  rn?: string;
  buldMnnm?: string;
  buldSlno?: string;
  lnbrMnnm?: string;
  lnbrSlno?: string;
};

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, "");
const norm = (v: unknown) => String(v ?? "").replace(/^0+(?=\d)/, "");

/** 도로명 토큰 + 건물번호까지만 남긴다 (상세주소·건물명 제거). 없으면 null */
function roadPrefix(tokens: string[]): string[] | null {
  for (let i = tokens.length - 2; i >= 0; i--) {
    if (ROAD.test(tokens[i]) && NUM.test(tokens[i + 1])) return tokens.slice(0, i + 2);
  }
  return null;
}

/** 키워드 안의 건물번호(마지막 숫자 토큰). 없으면 null */
function wantedNo(keyword: string): string | null {
  const t = keyword.split(/\s+/);
  for (let i = t.length - 1; i >= 0; i--) if (NUM.test(t[i])) return t[i];
  return null;
}

/** 조회 결과가 원 주소와 같은 곳인지 검증 — 오배송 방지 */
function verify(j: Juso, address: string): boolean {
  const flat = squash(address);
  // ① 시/군/구(또는 시/도)가 원 주소에 있어야 한다. "전주시 완산구"처럼 공백이 든 값이 있어 양쪽 다 공백 제거
  const sgg = squash(j.sggNm);
  const si = squash(j.siNm);
  const siShort = si.replace(/(특별자치도|특별자치시|광역시|특별시|도|시)$/, "");
  const regionOk =
    (!!sgg && flat.includes(sgg)) || (!!si && flat.includes(si)) || (siShort.length >= 2 && flat.includes(siShort));
  if (!regionOk) return false;
  // ② 도로명 주소면 도로명이, 지번 주소면 법정동이 원 주소에 있어야 한다
  if (/(로|길)\s*\d/.test(address) || /(로|길)\s/.test(address)) {
    return !!j.rn && flat.includes(squash(j.rn));
  }
  return !!j.emdNm && flat.includes(j.emdNm);
}

/** 후보 중 건물번호(본번-부번)까지 맞는 항목. 번호 없는 검색은 결과가 유일할 때만 신뢰 */
function pick(list: Juso[], want: string | null, address: string): Juso | null {
  const ok = list.filter((j) => verify(j, address));
  if (!want) return ok.length === 1 ? ok[0] : null;
  const [mn, sl = "0"] = want.split("-");
  return (
    ok.find((j) => norm(j.buldMnnm) === norm(mn) && norm(j.buldSlno || "0") === norm(sl)) ??
    ok.find((j) => norm(j.lnbrMnnm) === norm(mn) && norm(j.lnbrSlno || "0") === norm(sl)) ??
    null
  );
}

async function lookupOnce(keyword: string, key: string, address: string): Promise<string | null> {
  const url =
    `${JUSO_API}?` +
    new URLSearchParams({
      confmKey: key,
      currentPage: "1",
      countPerPage: "10",
      keyword,
      resultType: "json",
    });
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      results?: { common?: { errorCode?: string }; juso?: Juso[] };
    } | null;
    const code = json?.results?.common?.errorCode;
    if (code && code !== "0") return null;
    const hit = pick(json?.results?.juso ?? [], wantedNo(keyword), address);
    return hit?.zipNo && /^\d{5}$/.test(hit.zipNo) ? hit.zipNo : null;
  } catch {
    return null;
  }
}

/** 시도할 juso 키워드 후보(정확한 것부터, 중복 제거) */
function candidates(base: string): string[] {
  const tokens = base.split(" ");
  const variants = [tokens];
  if (CITY.test(tokens[0])) variants.push([tokens[0].replace(CITY, "$1"), ...tokens.slice(1)]);
  const out: string[] = [];
  // ① 도로명+건물번호까지만 (상세주소·건물명 제거) — 대부분 여기서 맞는다
  for (const tk of variants) {
    const rp = roadPrefix(tk);
    if (rp) out.push(rp.join(" "));
  }
  // ② 원문 → 뒤 토큰 점진 제거
  for (const tk of variants) {
    out.push(tk.join(" "));
    for (let drop = 1; drop <= 6 && tk.length - drop >= 2; drop++) out.push(tk.slice(0, tk.length - drop).join(" "));
  }
  // ③ 앞 토큰 제거(옛 행정구역·오타 대비: "대소면"→실제 "대소읍") — 마지막엔 도로명+건물번호만
  for (const tk of variants) {
    const rp = roadPrefix(tk) ?? tk;
    for (let lead = 1; lead <= rp.length - 2; lead++) out.push(rp.slice(lead).join(" "));
  }
  return [...new Set(out)];
}

/** 주소 → 우편번호. 키 미설정/조회 실패 시 null. */
export async function addrToZip(address: string): Promise<string | null> {
  const key = process.env.JUSO_CONFM_KEY;
  const raw = String(address ?? "");
  // 주소에 "(우)12345" 처럼 우편번호가 박혀 오는 채널이 있다
  const inline = raw.match(/\(\s*우\s*\)\s*(\d{5})|우편번호[:\s]*(\d{5})/);
  if (inline) return inline[1] || inline[2];
  const base = raw.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!key || !base) return null;
  for (const kw of candidates(base)) {
    const zip = await lookupOnce(kw, key, base);
    if (zip) return zip;
  }
  return null;
}
