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
 *
 * 우리은행 실물(2026-08 확인) — 줄바꿈으로 구분된 6줄:
 *   [Web발신] / 우리 08/24 15:12 / *097664 / 입금 13,000원 / 박형중 / 잔액 1,749,122원
 */

export interface ParsedDeposit {
  amount:         number;            // 원
  depositorName:  string | null;     // 마스킹 포함될 수 있음 ("홍**" 등)
  bank:           "KB" | "WOORI" | "OTHER";
  occurredAt:     string | null;     // ISO. SMS 에 시각 명시 안 되면 null
  /** 입금된 계좌 — 숫자만. SMS 는 보통 마스킹돼 뒷자리만 온다("*097664" → "097664"). */
  account:        string | null;
  /** 입금 후 잔액. 우리은행은 찍어주고, 안 주는 은행·요금제도 있어 null 가능. */
  balance:        number | null;
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

/**
 * 계좌 추출. 마스킹 형태가 은행마다 다르다("*097664", "***-456789", "234567-12-***123").
 * 날짜(2026-08-24)를 계좌로 오인하지 않게 숫자 9자리 이상만 계좌로 인정한다.
 */
function extractAccount(body: string): string | null {
  // 1순위: 우리은행식 마스킹 — '*' 뒤 숫자 뭉치.
  const masked = body.match(/\*+\s*(\d{4,})/);
  if (masked) return masked[1];

  // 2순위: 하이픈·마스킹 섞인 계좌 토큰. 숫자 9자리 이상이어야 계좌로 본다.
  for (const m of body.matchAll(/[\d*]{2,6}(?:-[\d*]{2,6}){1,3}/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 9) return digits;
  }
  return null;
}

/** "잔액 1,749,122원" → 1749122. 없으면 null. */
function extractBalance(body: string): number | null {
  const m = body.match(/잔액\s*[₩￦]?\s*([\d,]+)\s*원?/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** 입금자명 자리에 잡히기 쉬운 SMS 자체 단어 — 이름으로 채택하면 안 된다. */
const NAME_STOPWORDS = new Set([
  "잔액", "출금", "입금", "거래", "수수료", "계좌", "이체", "누적", "한도", "결제", "승인",
]);

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
    const name = m?.[1]?.trim();
    // "입금 13,000원 잔액 1,749,122원" 처럼 입금자명이 없으면 뒤 단어("잔액")가
    // 이름 자리에 잡힌다. 그대로 두면 매칭이 엉뚱한 주문을 물 수 있다.
    if (name && !NAME_STOPWORDS.has(name)) return name;
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
    account:       extractAccount(body),
    balance:       extractBalance(body),
    raw:           body.slice(0, 500),
  };
}
