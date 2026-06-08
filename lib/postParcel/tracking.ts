/**
 * 우체국 종추적조회 (공개 API, 공공데이터포털).
 * 인증키(ServiceKey)만 필요, SEED 암호화 없음. 등기번호(rgist)로 배송 진행상황 조회.
 *
 * env: POSTPARCEL_TRACK_KEY  (data.go.kr ServiceKey — encoding 키면 그대로, decoding 키면 인코딩됨)
 *
 * 엔드포인트(우체국 통합배송목록):
 *   http://openapi.epost.go.kr/trace/retrieveLongitudinalCombinedService/
 *     retrieveLongitudinalCombinedService/getLongitudinalCombinedList?serviceKey=..&rgist=..
 */

const TRACK_URL =
  "http://openapi.epost.go.kr/trace/retrieveLongitudinalCombinedService/" +
  "retrieveLongitudinalCombinedService/getLongitudinalCombinedList";

export interface TrackScan {
  date?: string; // 처리일시
  status?: string; // 처리상태 (예: 발송, 도착, 배달완료)
  location?: string; // 처리지점
}

export interface TrackResult {
  rgist: string;
  found: boolean;
  state?: string; // 최신 배송상태
  senderName?: string;
  receiverName?: string;
  scans: TrackScan[];
  error?: string;
  raw?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}\\s*>([\\s\\S]*?)<\\/${name}>`));
  return m ? decodeEntities(m[1]) : undefined;
}

// 반복되는 진행상황 블록 추출 (태그명이 응답마다 달라 후보를 모두 시도)
function extractScans(xml: string): TrackScan[] {
  const blockNames = ["trackInfoList", "trackInfoDetail", "item", "detail", "list"];
  for (const bn of blockNames) {
    const re = new RegExp(`<${bn}\\s*>([\\s\\S]*?)<\\/${bn}>`, "g");
    const scans: TrackScan[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
      const b = m[1];
      const date = tag(b, "trackDate") || tag(b, "date") || tag(b, "dateTime") || tag(b, "processDate");
      const status = tag(b, "trackState") || tag(b, "status") || tag(b, "processStatus") || tag(b, "remark");
      const location = tag(b, "trackLocation") || tag(b, "location") || tag(b, "processLocation") || tag(b, "place");
      if (date || status || location) scans.push({ date, status, location });
    }
    if (scans.length) return scans;
  }
  return [];
}

function buildUrl(rgist: string): string {
  const key = process.env.POSTPARCEL_TRACK_KEY || "";
  // encoding 키(%포함)는 그대로, 아니면 인코딩
  const keyParam = key.includes("%") ? key : encodeURIComponent(key);
  return `${TRACK_URL}?serviceKey=${keyParam}&rgist=${encodeURIComponent(rgist)}`;
}

/** 단건 종추적조회 */
export async function trackOne(rgist: string): Promise<TrackResult> {
  if (!process.env.POSTPARCEL_TRACK_KEY) {
    return { rgist, found: false, scans: [], error: "POSTPARCEL_TRACK_KEY 미설정" };
  }
  if (!rgist || rgist === "TESTREGINOAPI") {
    return { rgist, found: false, scans: [], error: "유효한 등기번호 없음(테스트 접수)" };
  }
  try {
    const res = await fetch(buildUrl(rgist), {
      headers: { Connection: "keep-alive", "User-Agent": "paulwise-dashboard" },
      signal: AbortSignal.timeout(15000),
    });
    const xml = await res.text();
    const errMsg = tag(xml, "errorMessage") || tag(xml, "cmmMsgHeader") || tag(xml, "returnAuthMsg");
    const scans = extractScans(xml);
    const state =
      tag(xml, "trackState") ||
      (scans.length ? scans[scans.length - 1].status : undefined);
    const found = !!(state || scans.length);
    return {
      rgist,
      found,
      state,
      senderName: tag(xml, "senderName"),
      receiverName: tag(xml, "receiveName") || tag(xml, "receiverName"),
      scans,
      error: !found ? errMsg || "조회 결과 없음" : undefined,
      raw: process.env.NODE_ENV === "development" ? xml.slice(0, 2000) : undefined,
    };
  } catch (e) {
    return { rgist, found: false, scans: [], error: (e as Error).message };
  }
}

/** 여러 건 종추적조회 (순차, 과도호출 방지) */
export async function trackMany(rgists: string[]): Promise<TrackResult[]> {
  const out: TrackResult[] = [];
  for (const r of rgists) {
    out.push(await trackOne(r));
  }
  return out;
}
