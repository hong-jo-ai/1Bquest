/**
 * 우리은행 입출금 알림 SMS 파서.
 *
 * 통장 거래는 그동안 엑셀 업로드로만 들어와서(bank-tx 라우트) 사장님이 안 올리면 공백이 생겼다
 * (2026-08-18 이후 0건). 알림 문자는 chat.db 에 계속 쌓이므로 그걸 읽어 자동 적재한다(2026-09-12).
 *
 * 문자 형식(줄바꿈은 공백으로 무너뜨려 본다):
 *   [Web발신] 우리 09/12 17:11 8491*01 출금 167,600원 현대카드 잔액 4,114,744원
 *   [Web발신] 우리 08/03 02:26 *097664 입금 412,874원 Npay정산 잔액 2,367,181원
 *   [Web발신] 우리 09/12 19:44 8491*01 출금취소 168,000원 한무쇼핑(주) 잔액 3,654,844원
 *
 * 계좌 식별자는 뒷자리만 온다 → 엑셀 업로드분과 같은 전체 계좌번호로 맞춰야 중복 제약이 작동한다.
 * SMS 엔 연도가 없어 수신시각으로 연도를 보정한다(카드 문자 파서와 같은 방식).
 */

export type BankSmsKind = "출금" | "입금" | "출금취소" | "입금취소";

export interface ParsedWooriBankSms {
  bank: "Woori";
  /** 문자에 찍힌 식별자 그대로 (예: "8491*01", "*097664") */
  accountTail: string;
  /** 엑셀 업로드분과 같은 전체 계좌번호. 매핑에 없으면 accountTail 그대로. */
  accountNumber: string;
  /** 사업계좌(1002) 인지 개인계좌(849) 인지 — 분류 기본값에 쓴다. */
  isPersonalAccount: boolean;
  kind: BankSmsKind;
  amount: number;
  counterparty: string;
  balance: number | null;
  txDate: Date;
  raw: string;
}

/** 문자 뒷자리 → 전체 계좌번호. ⚠️ 1002 가 주사업계좌, 849 가 개인계좌다(반대로 알기 쉽다). */
const ACCOUNT_MAP: Record<string, { full: string; personal: boolean }> = {
  "*097664": { full: "1002-166-097664", personal: false },
  "8491*01": { full: "849-172944-02-001", personal: true },
};

const KST_MS = 9 * 3600 * 1000;

function inferYear(month: number, day: number, h: number, mi: number, baseMs?: number): Date {
  const base = baseMs ? new Date(baseMs) : new Date();
  const baseKstYear = new Date(base.getTime() + KST_MS).getUTCFullYear();
  let d = new Date(Date.UTC(baseKstYear, month - 1, day, h, mi, 0, 0) - KST_MS);
  // 거래시각이 수신시각보다 2일 넘게 미래면 연말→연초 경계 — 직전 해로.
  if (d.getTime() - base.getTime() > 2 * 24 * 3600 * 1000) {
    d = new Date(Date.UTC(baseKstYear - 1, month - 1, day, h, mi, 0, 0) - KST_MS);
  }
  return d;
}

const RE =
  /우리\s+(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([*\d-]+)\s+(출금취소|입금취소|출금|입금)\s+([\d,]+)원\s*(.*?)\s*잔액\s+([\d,]+)원/;

/** 우리은행 입출금 알림이면 구조화, 아니면 null (카드 승인 문자·광고·인증번호 등은 null). */
export function parseWooriBankSms(text: string, receivedAtMs?: number): ParsedWooriBankSms | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  // 카드 승인 문자("우리(3660)체크승인")는 통장 문자가 아니다 — 여기서 걸러야 이중 적재가 안 난다.
  if (/우리\s*\(\d{3,4}\)/.test(flat)) return null;
  const m = flat.match(RE);
  if (!m) return null;

  const [, mo, dd, hh, mi, tail, kind, amt, cp, bal] = m;
  const amount = Number(amt.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const acct = ACCOUNT_MAP[tail];

  return {
    bank: "Woori",
    accountTail: tail,
    accountNumber: acct?.full ?? tail,
    isPersonalAccount: acct?.personal ?? false,
    kind: kind as BankSmsKind,
    amount,
    counterparty: cp.trim(),
    balance: bal ? Number(bal.replace(/,/g, "")) : null,
    txDate: inferYear(Number(mo), Number(dd), Number(hh), Number(mi), receivedAtMs),
    raw: text,
  };
}
