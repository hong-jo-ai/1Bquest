/**
 * 은행 입금 SMS 파서.
 *
 * 한국 은행 SMS 포맷이 은행·기간·요금제마다 미묘하게 달라서 정규식 한 방으로
 * 못 잡음. 핵심 정보(금액, 입금자명, 시각, 은행)만 휴리스틱으로 추출.
 *
 * 예시:
 *   [KB은행] 05/05 14:23 234567-12-***123 50,000원 입금 홍**
 *   [KB] 5/5 14:23 1234567 50,000 입금 홍길**
 *   [우리] 5/5 14:23 ***-456789 입금 50,000원 홍길동
 */

export interface ParsedDeposit {
  amount:         number;            // 원
  depositorName:  string | null;     // 마스킹 포함될 수 있음 ("홍**" 등)
  bank:           "KB" | "WOORI" | "OTHER";
  occurredAt:     string | null;     // ISO. SMS 에 시각 명시 안 되면 null
  raw:            string;            // 디버깅용 원문 (200자)
}

function detectBank(body: string, sender?: string): ParsedDeposit["bank"] {
  const haystack = `${sender ?? ""} ${body}`;
  // 한글은 \b 가 안 먹음. 단순 includes 매칭.
  if (/KB|국민은행|KB은행|KB Star/i.test(haystack)) return "KB";
  if (/우리은행|우리|WOORI|WON뱅킹/i.test(haystack)) return "WOORI";
  return "OTHER";
}

/** 콤마 포함 숫자만 — 계좌번호(연속 4자리 이상이지만 콤마 없음)는 제외하기 위해. */
const AMOUNT_NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d{1,4})`;

function extractAmount(body: string): number {
  // 1순위: "입금" 직후 숫자 (예: "입금 50,000원 홍**")
  const after = body.match(
    new RegExp(`입금\\s*(?:하셨습니다|되셨습니다)?\\s*[₩￦]?\\s*${AMOUNT_NUMBER}\\s*원?`),
  );
  if (after) {
    const n = parseInt(after[1].replace(/,/g, ""), 10);
    if (n >= 100) return n;
  }

  // 2순위: 숫자 + "입금" (예: "50,000원 입금")
  const before = body.match(
    new RegExp(`${AMOUNT_NUMBER}\\s*원?\\s*입금`),
  );
  if (before) {
    const n = parseInt(before[1].replace(/,/g, ""), 10);
    if (n >= 100) return n;
  }

  // 3순위: ₩ 기호 직후 (예: "₩50,000 입금")
  const won = body.match(new RegExp(`[₩￦]\\s*${AMOUNT_NUMBER}`));
  if (won) {
    const n = parseInt(won[1].replace(/,/g, ""), 10);
    if (n >= 100) return n;
  }

  return 0;
}

function extractDepositorName(body: string): string | null {
  // 한국 은행 SMS 입금자명 위치는 다양함:
  //   "입금 홍**"          ← 직후
  //   "입금 50,000 홍길동" ← 금액 거쳐서
  //   "입금 ₩50,000 홍길동"
  //   "...홍길동님 입금"
  //   끝부분에 "홍**"
  //
  // "입금" 키워드 뒤로 숫자/원/공백/통화기호를 건너뛰고 첫 한글 토큰이 이름.
  const patterns: RegExp[] = [
    // 입금 후 [숫자/원/통화/공백] 건너뛰고 한글+마스킹
    /입금[\s,.:;원₩￦\d]*([가-힣]{1,6}\*{1,4})/,
    /입금[\s,.:;원₩￦\d]*([가-힣]{2,6})(?=\s*$|\s+[^가-힣]|$)/,
    /입금[\s,.:;원₩￦\d]*([가-힣]{2,6})/,
    // 끝부분 마스킹된 이름
    /([가-힣]{1,5}\*{1,4})\s*(?:님)?\s*$/,
    // "홍길동님 입금"
    /([가-힣]{2,6})\s*님\s*입금/,
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function extractOccurredAt(body: string): string | null {
  // MM/DD HH:MM 또는 M/D H:MM 또는 YYYY/MM/DD HH:MM
  const m1 = body.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (m1) {
    const [, y, mo, d, h, mi] = m1;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h - 9, +mi)).toISOString();
  }
  const m2 = body.match(/(\d{1,2})[\/\-.](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (m2) {
    const [, mo, d, h, mi] = m2;
    const year = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
    return new Date(Date.UTC(year, +mo - 1, +d, +h - 9, +mi)).toISOString();
  }
  return null;
}

export function parseBankSms(rawBody: string, sender?: string): ParsedDeposit | null {
  if (!rawBody) return null;
  const body = rawBody.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  if (!/입금/.test(body)) return null;

  const amount = extractAmount(body);
  if (amount <= 0) return null;

  return {
    amount,
    depositorName: extractDepositorName(body),
    bank:          detectBank(body, sender),
    occurredAt:    extractOccurredAt(body),
    raw:           body.slice(0, 500),
  };
}
