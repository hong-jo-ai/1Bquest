/**
 * 우리은행 거래내역 Excel 파서.
 *
 * 형식 (인터넷뱅킹 "거래내역조회" 내려받기, .xls):
 *   행 0: "거래내역조회"
 *   행 1: "계좌번호 : 1002-166-097664"      ← 한 셀에 라벨+값이 같이 들어있다 (KB는 셀이 분리돼 있음)
 *   행 2: "조회기간 : 2026.04.01 ~ 2026.08.18"
 *   행 3: No. | 거래일시 | 적요 | 기재내용 | 찾으신금액 | 맡기신금액 | 거래후 잔액 | 취급기관 | 메모
 *   행 4~: 거래 데이터 (최신 → 과거 순)
 *
 * KB와 다른 점 — 이 셋 때문에 kbParser 를 그대로 못 쓴다:
 *   ① 컬럼명이 "출금액/입금액"이 아니라 **"찾으신금액/맡기신금액"**
 *   ② 거래일시에 **초가 없다** ("2026.08.18 18:23")
 *   ③ 계좌번호·조회기간이 **한 셀 안에** "라벨 : 값" 형태로 들어있다
 *
 * 반환 타입은 kbParser 의 ParsedBankTx 를 공유한다(적재 경로 동일).
 */
import * as XLSX from "xlsx";
import type { ParsedBankTx } from "./kbParser";

export interface WooriParseResult {
  accountNumber: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  rows: ParsedBankTx[];
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  return parseFloat(String(v ?? "0").replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
}

/** "2026.08.18 18:23" · "2026.08.18 18:23:05" · "2026.08.18" 모두 허용. */
function parseWooriDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = s.match(
    /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? 0),
    Number(mi ?? 0),
    Number(sec ?? 0)
  );
}

/** "계좌번호 : 1002-166-097664" → "1002-166-097664" */
function afterColon(cell: unknown): string | null {
  const s = String(cell ?? "");
  const i = s.indexOf(":");
  if (i < 0) return null;
  const v = s.slice(i + 1).trim();
  return v || null;
}

export function parseWooriBankExcel(buffer: ArrayBuffer): WooriParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true, cellNF: false });
  if (!wb.SheetNames.length) throw new Error("엑셀에 시트가 없습니다.");
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
    header: 1,
    defval: "",
  }) as unknown[][];

  if (allRows.length < 5) {
    throw new Error("우리은행 거래내역 형식이 아닙니다 (행 수 부족).");
  }

  // 메타: 라벨이 셀 0 에 통째로 들어있는 경우(우리)와 셀이 분리된 경우(혹시 모를 변형) 모두 대응
  const acctRow = allRows.find((r) => String(r[0]).includes("계좌번호"));
  const accountNumber = acctRow
    ? afterColon(acctRow[0]) ?? (String(acctRow[1] ?? "").trim() || null)
    : null;

  const periodRow = allRows.find((r) => String(r[0]).includes("조회기간"));
  const periodStr = periodRow ? `${periodRow[0]} ${periodRow[1] ?? ""}` : "";
  const pm = periodStr.match(/(\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2})/);
  const rangeStart = pm ? pm[1] : null;
  const rangeEnd = pm ? pm[2] : null;

  // 헤더 행 — "거래일시" 가 있는 행
  let headerIdx = -1;
  for (let i = 0; i < Math.min(12, allRows.length); i++) {
    if (allRows[i].some((c) => String(c).trim() === "거래일시")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error("우리은행 거래내역 헤더(거래일시)를 찾을 수 없습니다.");
  }

  const headers = allRows[headerIdx].map((c) => String(c).trim());
  const idx = (kw: string[]) => headers.findIndex((h) => kw.some((k) => h.includes(k)));

  const dateCol = idx(["거래일시", "거래일자"]);
  const descCol = idx(["적요"]);
  // 우리은행은 거래상대가 "기재내용" 컬럼에 들어온다.
  const partyCol = idx(["기재내용", "보낸분", "받는분", "거래상대"]);
  const memoCol = idx(["메모", "송금메모"]);
  const wdCol = idx(["찾으신금액", "출금"]);
  const dpCol = idx(["맡기신금액", "입금"]);
  const balCol = idx(["잔액"]);
  const branchCol = idx(["취급기관", "거래점"]);

  if (dateCol < 0 || wdCol < 0 || dpCol < 0) {
    throw new Error(
      `우리은행 거래내역의 필수 컬럼(거래일시·찾으신금액·맡기신금액)을 찾을 수 없습니다. 감지된 헤더: ${headers.join(" | ")}`
    );
  }

  const rows: ParsedBankTx[] = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r || r.every((c) => !c)) continue;

    const txDate = parseWooriDate(r[dateCol]);
    if (!txDate) continue; // 합계행·안내문구 등

    const withdrawal = parseNum(r[wdCol]);
    const deposit = parseNum(r[dpCol]);
    if (withdrawal === 0 && deposit === 0) continue;

    const bal = balCol >= 0 ? parseNum(r[balCol]) : 0;
    rows.push({
      txDate,
      description: descCol >= 0 ? String(r[descCol] ?? "").trim() : "",
      counterparty: partyCol >= 0 ? String(r[partyCol] ?? "").trim() : "",
      memo: memoCol >= 0 ? String(r[memoCol] ?? "").trim() : "",
      withdrawal,
      deposit,
      balance: bal || null,
      branch: branchCol >= 0 ? String(r[branchCol] ?? "").trim() : "",
    });
  }

  return { accountNumber, rangeStart, rangeEnd, rows };
}
