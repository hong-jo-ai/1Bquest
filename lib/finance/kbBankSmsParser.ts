/**
 * KB국민은행 입출금 알림 SMS 파서.
 *
 * 왜 필요했나: 제드아이티씨(면세점 벤더) 입금은 **국민은행 제이에이치 계좌**로 들어오는데,
 * 통장 적재가 엑셀 업로드뿐이라 2026-04-23 이후 통째로 비어 있었다. 미수금이 들어왔는지
 * 대시보드로 확인할 수 없어 매번 뱅킹 앱을 직접 봐야 했다(2026-09-16 신설).
 *
 * ⚠️ 우리은행과 결정적으로 다른 점: **이 계좌는 사업자가 다르다.**
 * 우리 1002 = 해리엇와치스(기본 사업자), KB 511301 = **제이에이치**.
 * 기본 사업자로 적재하면 면세점 입금이 엉뚱한 장부에 쌓인다 → 계좌마다 사업자를 명시한다.
 *
 * 문자 형식(줄바꿈은 공백으로 무너뜨려 본다. '원'·공백은 표기가 흔들려 전부 선택):
 *   [Web발신] KB국민은행 08/31 12:47 511301**828 입금 1,967,411 주식회사제드아이티 잔액 3,456,789
 *   [Web발신] KB국민 09/15 10:02 511301**828 출금 330,000원 박계순(박계순세무회 잔액 4,677,940원
 *   [Web발신] KB스타뱅킹 09/15 14:23 511301**828 입금 500,000 (주)제드아이티씨      ← 잔액 없음
 *
 * ⚠️ **잔액은 선택이다.** KB 는 알림 설정에 따라 잔액을 빼고 보낸다. 우리은행 문자를 본떠
 * 잔액을 필수로 뒀더니 수집 단계에서 통째로 걸러졌다(2026-09-16 실측: KB 수집 0건).
 * 은행 식별어도 "국민"이 아니라 "KB"만 오는 경우가 있어 둘 다 본다.
 */
import { type BankSmsKind, inferYear } from "./wooriBankSmsParser";

export interface ParsedKbBankSms {
  bank: "KB";
  /** 문자에 찍힌 마스킹 식별자 그대로 (예: "511301**828") */
  accountTail: string;
  /** 엑셀 업로드분과 같은 전체 계좌번호. 매핑에 없으면 accountTail 그대로. */
  accountNumber: string;
  isPersonalAccount: boolean;
  /** 이 계좌가 속한 사업자의 사업자등록번호. 모르면 null(→ 라우트가 적재를 거부한다). */
  businessRegNo: string | null;
  kind: BankSmsKind;
  amount: number;
  counterparty: string;
  balance: number | null;
  txDate: Date;
  raw: string;
}

interface KbAccount {
  full: string;
  personal: boolean;
  /** ⚠️ 사업자 ≠ 브랜드. 이 계좌의 장부 귀속 사업자다. */
  regNo: string;
}

/** 전체 계좌번호 → 속성. 문자엔 마스킹된 꼬리만 오므로 digitsMatch() 로 맞춘다. */
const KB_ACCOUNTS: KbAccount[] = [
  // 제이에이치(663-23-01279) 주계좌 — 면세점(제드아이티씨) 정산·미수금이 여기로 들어온다.
  { full: "511301-01-111828", personal: false, regNo: "663-23-01279" },
];

/**
 * 마스킹된 꼬리("511301**828")가 전체 계좌번호("511301-01-111828")와 같은 계좌인가.
 * 은행이 마스킹 위치를 바꿔도(앞 6 + 뒤 3 → 앞 4 + 뒤 4) 따라가도록 앞뒤 숫자로만 판정한다.
 */
function digitsMatch(tail: string, full: string): boolean {
  const fullDigits = full.replace(/\D/g, "");
  const parts = tail.split(/\*+/).filter(Boolean);
  if (!parts.length) return false;
  const head = parts[0];
  const foot = parts.length > 1 ? parts[parts.length - 1] : "";
  if (head.length + foot.length < 4) return false; // 너무 짧으면 오인 위험 — 매칭 포기
  if (!fullDigits.startsWith(head)) return false;
  return foot ? fullDigits.endsWith(foot) : true;
}

/** 잔액이 붙는 형식 — 거래처는 금액과 '잔액' 사이. */
const RE_WITH_BALANCE =
  /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([\d][\d*]{3,})\s*(출금취소|입금취소|출금|입금)\s*([\d,]+)\s*원?\s*(.*?)\s*잔액\s*([\d,]+)\s*원?/;
/** 잔액이 없는 형식 — 금액 뒤 나머지가 거래처. */
const RE_NO_BALANCE =
  /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([\d][\d*]{3,})\s*(출금취소|입금취소|출금|입금)\s*([\d,]+)\s*원?\s*(.*)$/;

/**
 * 🔴 **거래처가 입출금 *앞*에 오는 형식** — 실제로 오는 문자는 이쪽이다(2026-09-16 실측).
 *   [Web발신] [KB]09/16 13:44 511301**828 주식회사제드아이티 입금 1,219,478 잔액2,592,694
 * 위 RE_WITH_BALANCE/RE_NO_BALANCE 는 계좌 바로 뒤에 입금/출금이 오기를 기대해서
 * chat.db 의 KB 문자 **84건 전부(6~9월)가 매칭 0건**이었다 → 통째로 nonBank 로 버려졌다.
 * 은행 식별어("[KB]")가 날짜와 붙어 있어도 날짜부터 매칭하므로 무관하고,
 * "잔액2,592,694" 처럼 공백이 없어도 `잔액\s*` 가 흡수한다.
 * ⚠️ 거래처는 non-greedy 로 잡되 숫자로 시작하는 금액을 삼키지 않도록 입출금 키워드에서 끊는다.
 */
const RE_CP_FIRST_WITH_BALANCE =
  /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([\d][\d*]{3,})\s+(.*?)\s*(출금취소|입금취소|출금|입금)\s*([\d,]+)\s*원?\s*잔액\s*([\d,]+)\s*원?/;
/** 같은 순서, 잔액 없음(KB 는 알림 설정에 따라 잔액을 뺀다). */
const RE_CP_FIRST_NO_BALANCE =
  /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s+([\d][\d*]{3,})\s+(.*?)\s*(출금취소|입금취소|출금|입금)\s*([\d,]+)\s*원?\s*$/;

/** KB국민은행 입출금 알림이면 구조화, 아니면 null (카드 승인·광고·인증번호 등은 null). */
export function parseKbBankSms(text: string, receivedAtMs?: number): ParsedKbBankSms | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  // 국민은행 문자인지부터. (우리은행 문자는 앞단 파서가 이미 가져간다)
  if (!/KB국민|국민은행|\bKB\b/.test(flat)) return null;
  // 카드 승인 문자는 통장 문자가 아니다 — 카드 파이프라인에서 따로 잡으므로 여기서 걸러야 이중 적재가 안 난다.
  if (/체크승인|일시불|할부|승인취소|카드\s*승인|승인\s*카드/.test(flat)) return null;

  // 잔액 있는 형식을 먼저 — 없는 형식 정규식은 잔액까지 거래처로 삼켜버린다.
  // ⚠️ 두 계열은 **캡처 순서가 다르다**(거래처와 입출금의 위치가 뒤바뀐다) → 분해도 따로 한다.
  let mo: string, dd: string, hh: string, mi: string;
  let tail: string, kind: string, amt: string, cp: string, bal: string | undefined;

  const mLegacy = flat.match(RE_WITH_BALANCE) ?? flat.match(RE_NO_BALANCE);
  if (mLegacy) {
    [, mo, dd, hh, mi, tail, kind, amt, cp, bal] = mLegacy;
  } else {
    const mCp = flat.match(RE_CP_FIRST_WITH_BALANCE) ?? flat.match(RE_CP_FIRST_NO_BALANCE);
    if (!mCp) return null;
    [, mo, dd, hh, mi, tail, cp, kind, amt, bal] = mCp;
  }
  const amount = Number(amt.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const acct = KB_ACCOUNTS.find((a) => digitsMatch(tail, a.full));

  return {
    bank: "KB",
    accountTail: tail,
    accountNumber: acct?.full ?? tail,
    isPersonalAccount: acct?.personal ?? false,
    businessRegNo: acct?.regNo ?? null,
    kind: kind as BankSmsKind,
    amount,
    counterparty: cp.trim().slice(0, 100),
    balance: bal ? Number(bal.replace(/,/g, "")) : null,
    txDate: inferYear(Number(mo), Number(dd), Number(hh), Number(mi), receivedAtMs),
    raw: text,
  };
}
