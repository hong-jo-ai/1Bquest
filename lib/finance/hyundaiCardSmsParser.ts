/**
 * 현대카드 승인/취소 SMS 파서.
 *
 * 현대카드 사용내역은 2026-06-06 이후 어떤 경로로도 안 들어오고 있었다(명세서 메일 수동 처리 대기).
 * 사장님이 현대카드 앱에서 승인 알림을 문자로 받게 하면 chat.db → card-sms 라우트로 자동 적재된다.
 *
 * ⚠️ 2026-09-12 작성 시점엔 실제 수신 문자가 없어 **현대카드 공개 형식**으로 만들었다.
 *    첫 문자가 오면 raw 를 보고 맞춰야 한다. 대표 형식(줄 단위):
 *
 *   [Web발신]
 *   현대카드 승인          ← "현대카드(1234) 승인" / "현대카드 취소" 변형 대응
 *   홍*조님
 *   11,900원 일시불        ← "3개월" 할부 변형
 *   09/12 15:54
 *   가맹점명
 *   누적1,234,567원        ← 누적/잔여/잔액 줄은 가맹점으로 보지 않는다
 *
 * 반환 형태는 우리카드 파서와 같게 맞춰 card-sms 라우트가 그대로 적재한다.
 */
import type { ParsedWooriSms } from "./wooriCardSmsParser";

export type ParsedCardSms = Omit<ParsedWooriSms, "cardCompany"> & { cardCompany: "우리" | "현대" };

const DT_RE = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/;
const AMT_RE = /([\d,]+)\s*원(?:\s*(일시불|\d+\s*개월))?/;
const KST_MS = 9 * 3600 * 1000;

function inferYear(month: number, day: number, h: number, mi: number, baseMs?: number): Date {
  const base = baseMs ? new Date(baseMs) : new Date();
  const baseKstYear = new Date(base.getTime() + KST_MS).getUTCFullYear();
  let d = new Date(Date.UTC(baseKstYear, month - 1, day, h, mi, 0, 0) - KST_MS);
  if (d.getTime() - base.getTime() > 2 * 24 * 3600 * 1000) {
    d = new Date(Date.UTC(baseKstYear - 1, month - 1, day, h, mi, 0, 0) - KST_MS);
  }
  return d;
}

/** 현대카드 승인/취소 문자면 구조화, 아니면 null (리워드·자동이체 안내 같은 공지는 null). */
export function parseHyundaiCardSms(text: string, receivedAtMs?: number): ParsedCardSms | null {
  if (!text || !/현대카드/.test(text)) return null;
  const isCanceled = /취소/.test(text);
  if (!/승인/.test(text) && !isCanceled) return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^\[Web발신\]$/.test(l));
  const dtIdx = lines.findIndex((l) => DT_RE.test(l));
  const amtIdx = lines.findIndex((l) => AMT_RE.test(l) && !/누적|잔액|잔여|한도/.test(l));
  // 승인 문자는 반드시 금액 줄과 일시 줄이 있다. 둘 중 하나라도 없으면 공지 문자다.
  if (dtIdx < 0 || amtIdx < 0) return null;

  const dt = lines[dtIdx].match(DT_RE)!;
  const am = lines[amtIdx].match(AMT_RE)!;
  const amount = Number(am[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const cardLine = lines.find((l) => /현대카드/.test(l)) ?? "";
  const cardNo = cardLine.match(/\((\d{3,4})\)/);
  const holder = (lines.find((l) => /님$/.test(l)) ?? "").replace(/님$/, "");

  // 가맹점: 일시 줄 다음 줄들 중 누적/잔액 류가 아닌 첫 줄. 일시 줄에 같이 붙어 온 경우도 본다.
  const sameLine = lines[dtIdx].replace(DT_RE, "").trim();
  let merchant = sameLine && !/누적|잔액|잔여/.test(sameLine) ? sameLine : "";
  if (!merchant) {
    merchant =
      lines.slice(dtIdx + 1).find((l) => !/누적|잔액|잔여|한도|승인|취소/.test(l) && !AMT_RE.test(l)) ?? "";
  }
  if (!merchant) merchant = "현대카드 (가맹점 미상)";

  return {
    cardCompany: "현대",
    cardNumber: cardNo ? cardNo[1] : "",
    cardKind: /체크/.test(cardLine) ? "체크" : /신용/.test(cardLine) ? "신용" : "",
    holder,
    amount,
    installment: (am[2] ?? "일시불").replace(/\s+/g, ""),
    merchant,
    useDate: inferYear(Number(dt[1]), Number(dt[2]), Number(dt[3]), Number(dt[4]), receivedAtMs),
    isCanceled,
    isForeign: false,
    foreignCurrency: "",
    foreignAmount: 0,
    raw: text,
  };
}
