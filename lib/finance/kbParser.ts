/**
 * KB국민은행 거래내역 Excel 파서.
 *
 * 형식:
 *   행 0~3: 메타 정보 (조회기간, 계좌번호, 예금종류 등)
 *   행 4   : 컬럼명 (거래일시, 적요, 보낸분/받는분, 송금메모, 출금액, 입금액, 잔액, 거래점, 구분)
 *   행 5~  : 거래 데이터
 */
import * as XLSX from "xlsx";

export interface ParsedBankTx {
  txDate: Date;
  description: string;       // 적요
  counterparty: string;      // 보낸분/받는분
  memo: string;              // 송금메모
  withdrawal: number;        // 출금액
  deposit: number;           // 입금액
  balance: number | null;    // 잔액
  branch: string;            // 거래점
}

export interface KbParseResult {
  accountNumber: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  rows: ParsedBankTx[];
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  return parseFloat(String(v ?? "0").replace(/,/g, "").replace(/[^\d.-]/g, "")) || 0;
}

function parseKbDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  // KB 형식: "2026.04.23 12:40:41" → ISO
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const [, y, mo, d, h, mi, sec] = m;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(sec)
    );
  }
  // Date-only fallback
  const m2 = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (m2) {
    const [, y, mo, d] = m2;
    return new Date(Number(y), Number(mo) - 1, Number(d));
  }
  const d = new Date(s.replace(/\./g, "-"));
  return isNaN(d.getTime()) ? null : d;
}

export function parseKbBankExcel(buffer: ArrayBuffer): KbParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    cellNF: false,
  });
  if (!wb.SheetNames.length) throw new Error("엑셀에 시트가 없습니다.");
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
  }) as unknown[][];

  if (allRows.length < 6) {
    throw new Error("KB 거래내역 형식이 아닙니다 (행 수 부족).");
  }

  // 메타 정보 추출
  const accountNumber =
    allRows.find((r) => String(r[0]).includes("계좌번호"))?.[1] as string | undefined ?? null;
  const periodRow = allRows.find((r) => String(r[0]).includes("조회기간"));
  let rangeStart: string | null = null;
  let rangeEnd: string | null = null;
  if (periodRow) {
    const periodStr = String(periodRow[1] ?? "");
    const m = periodStr.match(/(\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2})/);
    if (m) {
      rangeStart = m[1];
      rangeEnd = m[2];
    }
  }

  // 헤더 행 찾기 (보통 4번째 행)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i].map((c) => String(c));
    if (row.includes("거래일시") || row.some((c) => c.includes("거래일"))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error("KB 거래내역 헤더(거래일시 등)를 찾을 수 없습니다.");
  }

  const headers = allRows[headerIdx].map((c) => String(c).trim());
  const idx = (kw: string[]) =>
    headers.findIndex((h) => kw.some((k) => h.includes(k)));

  const dateCol = idx(["거래일시", "거래일자", "거래일"]);
  const descCol = idx(["적요"]);
  const partyCol = idx(["보낸분", "받는분", "거래상대"]);
  const memoCol = idx(["송금메모", "메모"]);
  const wdCol = idx(["출금액", "출금", "지출"]);
  const dpCol = idx(["입금액", "입금", "수입"]);
  const balCol = idx(["잔액"]);
  const branchCol = idx(["거래점"]);

  if (dateCol < 0 || (wdCol < 0 && dpCol < 0)) {
    throw new Error(
      `KB 거래내역의 필수 컬럼(거래일시 + 출금/입금)을 찾을 수 없습니다. 감지된 헤더: ${headers.join(" | ")}`
    );
  }

  const rows: ParsedBankTx[] = [];
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r || r.every((c) => !c)) continue;

    const txDate = parseKbDate(r[dateCol]);
    if (!txDate) continue;

    const withdrawal = wdCol >= 0 ? parseNum(r[wdCol]) : 0;
    const deposit = dpCol >= 0 ? parseNum(r[dpCol]) : 0;
    if (withdrawal === 0 && deposit === 0) continue;

    rows.push({
      txDate,
      description: descCol >= 0 ? String(r[descCol] ?? "").trim() : "",
      counterparty: partyCol >= 0 ? String(r[partyCol] ?? "").trim() : "",
      memo: memoCol >= 0 ? String(r[memoCol] ?? "").trim() : "",
      withdrawal,
      deposit,
      balance: balCol >= 0 ? (() => { const v = parseNum(r[balCol]); return v || null; })() : null,
      branch: branchCol >= 0 ? String(r[branchCol] ?? "").trim() : "",
    });
  }

  return { accountNumber, rangeStart, rangeEnd, rows };
}
