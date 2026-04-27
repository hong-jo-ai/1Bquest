/**
 * W컨셉 일별 성과 리포트 CSV 파서.
 *
 * 형식:
 *   행 0: 헤더 — "","날짜","집행 광고비","ROAS",...,"매출",...,"통화"
 *   행 1+: 데이터 행 (1행당 1일)
 *
 * 추출:
 *   - date: YYYY-MM-DD
 *   - spend: 집행 광고비 (KRW, 콤마 제거)
 *   - revenue: 매출 (KRW, optional 분석용)
 */
export interface ParsedWconceptAdRow {
  date: string;
  spend: number;
  revenue: number;
}

export interface WconceptAdsParseResult {
  rows: ParsedWconceptAdRow[];
}

function parseNum(v: string): number {
  return parseFloat(v.replace(/,/g, "").replace(/[^\d.\-]/g, "")) || 0;
}

/** 단순 CSV 파서 — RFC 4180 따름 (인용 + 콤마 + 줄바꿈) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

export function parseWconceptAdsCsv(text: string): WconceptAdsParseResult {
  // BOM 제거
  const cleaned = text.replace(/^﻿/, "");
  const rows = parseCsv(cleaned);
  if (rows.length < 2) throw new Error("CSV 데이터가 비어 있습니다.");

  const header = rows[0].map((h) => h.replace(/\s+/g, ""));
  const idx = (kw: string) => header.findIndex((h) => h === kw);

  const cDate = idx("날짜");
  const cSpend = idx("집행광고비");
  const cRevenue = idx("매출");

  if (cDate < 0 || cSpend < 0) {
    throw new Error(
      `W컨셉 광고 리포트 형식이 아닙니다. 감지된 헤더: ${header.join(" | ")}`
    );
  }

  const out: ParsedWconceptAdRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => !c)) continue;

    const date = (r[cDate] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    out.push({
      date,
      spend: parseNum(r[cSpend] ?? "0"),
      revenue: cRevenue >= 0 ? parseNum(r[cRevenue] ?? "0") : 0,
    });
  }

  return { rows: out };
}
