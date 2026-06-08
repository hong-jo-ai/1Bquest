/**
 * 우체국 종추적조회 (계약고객 OpenAPI — 소포신청과 동일 인증키).
 *
 * 엔드포인트: http://biz.epost.go.kr/KpostPortal/openapi
 *   regkey  = OpenAPI 인증키(30자리) — 소포신청과 같은 키 (env POSTPARCEL_TRACK_KEY)
 *   target  = trace(국내) / emsTrace(국제한글) / emsEngTrace(국제영문) / traceOrdNo(주문번호)
 *   query   = 등기번호 13자리 (국내)
 *   showRec = Y → 계약소포 간편접수 건의 "접수" 정보까지 포함
 * 응답: XML. 성공 시 이벤트별 필드(eventymd/eventhms/eventnm/eventregiponm 등),
 *       오류 시 <error_code>/<message> (예: ERR-001 조회결과없음, ERR-123 인증키오류, ERR-321 등기 13자리).
 * SEED 암호화 불필요.
 */

const TRACK_URL = "http://biz.epost.go.kr/KpostPortal/openapi";

export interface TrackScan {
  date?: string; // 처리일시 (eventymd + eventhms)
  status?: string; // 배달결과 상태 (eventnm)
  location?: string; // 현재 위치/우체국 (eventregiponm)
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

function decode(s: string): string {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// leaf 태그 첫 값
function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}\\s*>((?:(?!<\\/?[a-zA-Z])[\\s\\S])*?)<\\/${name}>`));
  return m ? decode(m[1]) : undefined;
}
// leaf 태그 모든 값 (이벤트별 반복)
function allTags(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}\\s*>((?:(?!<\\/?[a-zA-Z])[\\s\\S])*?)<\\/${name}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(decode(m[1]));
  return out;
}

function buildUrl(rgist: string): string {
  const p = new URLSearchParams({
    regkey: process.env.POSTPARCEL_TRACK_KEY || "",
    target: "trace",
    query: rgist,
    showRec: "Y",
  });
  return `${TRACK_URL}?${p.toString()}`;
}

/** 단건 종추적조회 (국내 등기 13자리) */
export async function trackOne(rgist: string): Promise<TrackResult> {
  if (!process.env.POSTPARCEL_TRACK_KEY) {
    return { rgist, found: false, scans: [], error: "POSTPARCEL_TRACK_KEY 미설정" };
  }
  if (!rgist || rgist === "TESTREGINOAPI" || !/^\d{9,13}$/.test(rgist.replace(/\D/g, ""))) {
    return { rgist, found: false, scans: [], error: "유효한 등기번호 아님(13자리 필요)" };
  }
  try {
    const res = await fetch(buildUrl(rgist), {
      headers: { Connection: "keep-alive", "User-Agent": "paulwise-dashboard" },
      signal: AbortSignal.timeout(15000),
    });
    const xml = await res.text();

    const errCode = tag(xml, "error_code");
    if (errCode) {
      const msg = tag(xml, "message") || errCode;
      // ERR-001(조회결과없음)은 정상 흐름 — 아직 미배송
      return { rgist, found: false, scans: [], error: msg, raw: process.env.NODE_ENV === "development" ? xml.slice(0, 1500) : undefined };
    }

    // 이벤트별 필드 zip (컨테이너 구조 무관, leaf 발생 순서로 묶음)
    const ymd = allTags(xml, "eventymd");
    const hms = allTags(xml, "eventhms");
    const nm = allTags(xml, "eventnm");
    const loc = allTags(xml, "eventregiponm");
    const n = Math.max(ymd.length, nm.length, loc.length);
    const scans: TrackScan[] = [];
    for (let i = 0; i < n; i++) {
      scans.push({
        date: [ymd[i], hms[i]].filter(Boolean).join(" ").trim() || undefined,
        status: nm[i],
        location: loc[i],
      });
    }
    const state = tag(xml, "tracestatus") || (scans.length ? scans[scans.length - 1].status : undefined);
    const found = scans.length > 0 || !!state;
    return {
      rgist,
      found,
      state,
      senderName: tag(xml, "sendnm"),
      receiverName: tag(xml, "recevnm"),
      scans,
      error: found ? undefined : "조회 결과 없음",
      raw: process.env.NODE_ENV === "development" ? xml.slice(0, 1500) : undefined,
    };
  } catch (e) {
    return { rgist, found: false, scans: [], error: (e as Error).message };
  }
}

/** 여러 건 종추적조회 (순차) */
export async function trackMany(rgists: string[]): Promise<TrackResult[]> {
  const out: TrackResult[] = [];
  for (const r of rgists) out.push(await trackOne(r));
  return out;
}
