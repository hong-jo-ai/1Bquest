/**
 * 우리카드 승인/취소 SMS 파서.
 *
 * iMac Messages(chat.db)로 들어온 우리카드 이용안내 문자를 구조화한다.
 * 카드 알림 SMS는 줄 단위로 오며, 대표 형식:
 *
 *   [우리카드 이용 안내]
 *   우리(0969)체크승인
 *   홍*조님
 *   60,000원 일시불
 *   06/11 09:48
 *   궁내동주유소
 *
 * 변형 대응: 신용/체크, 승인/취소, 일시불/N개월(할부), 누적·잔액 줄 존재,
 * 가맹점이 일시(日時) 줄 뒤 또는 같은 줄에 오는 경우.
 * SMS엔 연도가 없어 수신시각(receivedAtMs)으로 연도를 보정한다(없으면 현재).
 */

export interface ParsedWooriSms {
  cardCompany: "우리";
  cardNumber: string; // 끝 4자리 (예: "0969")
  cardKind: string; // 체크 | 신용 | ""
  holder: string; // 마스킹 이름 (예: "홍*조")
  amount: number; // 승인금액(원)
  installment: string; // 일시불 | "3개월" 등
  merchant: string;
  useDate: Date; // 연도 보정된 결제일시
  isCanceled: boolean;
  raw: string;
}

const DT_RE = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/;

function inferYear(month: number, day: number, h: number, mi: number, baseMs?: number): Date {
  const base = baseMs ? new Date(baseMs) : new Date();
  const d = new Date(base.getFullYear(), month - 1, day, h, mi, 0, 0);
  // 결제일시가 수신시각보다 미래로 나오면(연말→연초 경계) 직전 해로 보정.
  if (d.getTime() - base.getTime() > 2 * 24 * 3600 * 1000) d.setFullYear(base.getFullYear() - 1);
  return d;
}

/** 우리카드 승인/취소 SMS면 구조화, 아니면 null. */
export function parseWooriCardSms(text: string, receivedAtMs?: number): ParsedWooriSms | null {
  if (!text) return null;
  const isWoori = /우리\s*\(?\d{3,4}/.test(text) || /우리카드/.test(text);
  if (!isWoori) return null;
  const isCanceled = /취소/.test(text);
  if (!/승인/.test(text) && !isCanceled) return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 카드 줄: "우리(0969)체크승인"
  const cardLine = lines.find((l) => /우리\s*\(?\d{3,4}/.test(l)) ?? "";
  const cardNo = cardLine.match(/\(?(\d{3,4})\)?/);
  const cardNumber = cardNo ? cardNo[1] : "";
  const cardKind = /신용/.test(cardLine) ? "신용" : /체크/.test(cardLine) ? "체크" : "";

  // 이름 줄: "홍*조님"
  const holder = (lines.find((l) => /님$/.test(l) && l.length <= 12) ?? "").replace(/님$/, "");

  // 금액 줄: 누적/잔액/한도 제외, '일시불|개월|할부' 있는 줄 우선
  const amtLines = lines.filter((l) => /[\d,]+\s*원/.test(l) && !/누적|잔액|누계|한도/.test(l));
  const amtLine = amtLines.find((l) => /일시불|개월|할부/.test(l)) ?? amtLines[0] ?? "";
  const amtM = amtLine.match(/([\d,]+)\s*원/);
  const amount = amtM ? Number(amtM[1].replace(/,/g, "")) : 0;
  let installment = "";
  if (/일시불/.test(amtLine)) installment = "일시불";
  else {
    const im = amtLine.match(/(\d{1,2})\s*개월/);
    if (im) installment = `${Number(im[1])}개월`;
  }

  // 일시(日時): MM/DD HH:MM
  const dtM = text.match(DT_RE);
  const useDate = dtM
    ? inferYear(Number(dtM[1]), Number(dtM[2]), Number(dtM[3]), Number(dtM[4]), receivedAtMs)
    : receivedAtMs
      ? new Date(receivedAtMs)
      : new Date();

  // 가맹점: 일시 줄 다음 줄 우선, 아니면 메타(헤더/카드/이름/금액/일시/누적/잔액) 아닌 마지막 줄.
  const isMeta = (l: string) =>
    /^\[.*\]$/.test(l) ||
    l === cardLine ||
    l === amtLine ||
    (/님$/.test(l) && l.length <= 12) ||
    DT_RE.test(l) ||
    /누적|잔액|누계|한도/.test(l);
  let merchant = "";
  const dtIdx = lines.findIndex((l) => DT_RE.test(l));
  if (dtIdx >= 0) {
    // 일시 줄에 가맹점이 같이 붙은 경우: 시각 토큰을 제거한 잔여 텍스트
    const rest = lines[dtIdx].replace(DT_RE, "").trim();
    if (rest) merchant = rest;
    else {
      for (let i = dtIdx + 1; i < lines.length; i++) {
        if (!isMeta(lines[i])) { merchant = lines[i]; break; }
      }
    }
  }
  if (!merchant) {
    const cands = lines.filter((l) => !isMeta(l));
    merchant = cands[cands.length - 1] ?? "";
  }

  return {
    cardCompany: "우리",
    cardNumber,
    cardKind,
    holder,
    amount,
    installment,
    merchant,
    useDate,
    isCanceled,
    raw: text,
  };
}
