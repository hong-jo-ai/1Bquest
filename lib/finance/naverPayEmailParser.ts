/**
 * 네이버페이 "결제하신 내역" 이메일 파서.
 *
 * 우리카드를 네이버페이 간편결제로 쓰면 카드 SMS 가맹점이 "네이버파이낸셜"로만 찍힌다.
 * 네이버페이가 결제마다 보내는 구매확인 메일에서 실제 가맹점·금액·일시를 떼내
 * 카드내역(finance_card_usage)을 보강한다.
 *
 * 메일 본문(렌더 예시):
 *   네이버페이로 결제하신 내역입니다.
 *   고객명        홍*조님
 *   결제번호      20260611NP8699724918
 *   결제일시      2026.06.11 07:08
 *   가맹점명      주식회사 엠힙
 *   총 결제 금액   2,900원
 *   ㄴ 신용금액    2,900원
 *   결제수단      카드 간편결제
 *   최종결제금액   2,900원
 *
 * HTML/plain 어느 쪽이 와도 동작하도록 태그를 제거·정규화한 뒤 라벨 기준으로 추출한다.
 */

export interface ParsedNaverPayEmail {
  payNo: string; // 결제번호 (멱등 키)
  merchant: string; // 가맹점명 (실제 상점)
  paidAt: Date | null; // 결제일시
  totalAmount: number; // 최종/총 결제 금액
  cardAmount: number; // 신용금액(=카드 청구액). 없으면 totalAmount
  method: string; // 결제수단
  raw: string;
}

/** HTML → 라벨/값이 줄단위로 분리된 평문으로 정규화. */
function toText(input: string): string {
  let s = input;
  if (/<[a-z!/]/i.test(s)) {
    s = s
      .replace(/<\s*(br|tr|td|th|p|div|li|h[1-6])[^>]*>/gi, "\n")
      .replace(/<\/\s*(tr|td|th|p|div|li|h[1-6])\s*>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t ]+/g, " ")
    .replace(/\r/g, "");
  // 줄별 trim + 빈 줄 제거
  return s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/** 라벨 다음 값(같은 줄 또는 다음 줄)을 반환. stop 라벨 전까지. */
function valueAfter(text: string, label: RegExp): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(label);
    if (!m) continue;
    // 같은 줄에서 라벨 뒤 잔여
    const after = lines[i].slice((m.index ?? 0) + m[0].length).replace(/^[\s:·ㄴ>|-]+/, "").trim();
    if (after) return after;
    // 다음 비어있지 않은 줄
    for (let j = i + 1; j < lines.length; j++) {
      const v = lines[j].replace(/^[\s:·ㄴ>|-]+/, "").trim();
      if (v) return v;
    }
  }
  return "";
}

function won(s: string): number {
  const m = (s || "").match(/([\d,]+)\s*원?/);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

function parsePaidAt(s: string): Date | null {
  // 2026.06.11 07:08  (또는 2026-06-11 07:08)
  const m = (s || "").match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) {
    const d = (s || "").match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (!d) return null;
    return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

/** 네이버페이 결제 메일이면 구조화, 아니면 null. */
export function parseNaverPayEmail(input: string): ParsedNaverPayEmail | null {
  if (!input) return null;
  const text = toText(input);
  if (!/네이버페이|naver\s*pay/i.test(text) || !/가맹점/.test(text)) return null;

  const merchant = valueAfter(text, /가맹점\s*(?:명)?/);
  const payNo = valueAfter(text, /결제\s*번호/).split(/\s/)[0] || "";
  const paidAt = parsePaidAt(valueAfter(text, /결제\s*(?:일시|일자)/));
  const total = won(valueAfter(text, /최종\s*결제\s*금액/)) || won(valueAfter(text, /총\s*결제\s*금액/));
  const card = won(valueAfter(text, /신용\s*금액/));
  const method = valueAfter(text, /결제\s*수단/);

  if (!merchant && !total) return null;
  return {
    payNo,
    merchant,
    paidAt,
    totalAmount: total,
    cardAmount: card || total,
    method,
    raw: input.slice(0, 4000),
  };
}
