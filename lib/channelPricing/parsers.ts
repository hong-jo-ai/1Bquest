import * as XLSX from "xlsx";
import type {
  NormalizedChannelProduct,
  ChannelParseResult,
  PricingChannel,
} from "./types";

/**
 * 채널 상품목록 엑셀 파서.
 *
 * 채널마다 컬럼명/구조/형식이 다르다 (W컨셉 xlsx / 무신사 SpreadsheetML XML / 29cm xlsx).
 * 컬럼은 헤더명 alias 로 찾아 인덱스 의존을 줄이고, 정가/할인가/net 을 정규화한다.
 *
 * net(우리 실수령) 산출:
 *   - W컨셉: 공급가 컬럼
 *   - 무신사: '원가' 컬럼 (= 판매가 − 수수료금액. 무신사 용어가 '원가'일 뿐 우리 COGS 아님)
 *   - 29cm:  공급단가 컬럼
 */

type Aliases = string[];

interface ParserConfig {
  format: "sheet" | "spreadsheetml";
  /** 특정 시트명 (없으면 첫 시트) */
  sheetName?: string;
  columns: {
    code: Aliases;
    name: Aliases;
    image?: Aliases;
    list: Aliases;
    discount: Aliases;
    net: Aliases;
    status?: Aliases;
    brand?: Aliases;
  };
  /** 이 값과 일치하는 brand 행만 유지 (부분일치) */
  brandFilter?: string;
}

const CONFIGS: Record<Exclude<PricingChannel, "cafe24" | "kakao_gift">, ParserConfig> = {
  wconcept: {
    format: "sheet",
    columns: {
      code: ["상품코드"],
      name: ["상품명"],
      list: ["정상가"],
      discount: ["실판매가"],
      net: ["공급가"],
      status: ["판매상태"],
    },
  },
  musinsa: {
    format: "spreadsheetml",
    columns: {
      code: ["상품번호"],
      name: ["상품명"],
      image: ["이미지"],
      list: ["정상가"],
      discount: ["판매가"],
      net: ["원가"], // = 판매가 − 수수료금액 (우리 실수령)
      status: ["상품상태"],
      brand: ["브랜드"],
    },
    brandFilter: "폴바이스",
  },
  "29cm": {
    format: "sheet",
    sheetName: "상품 관리 정보",
    columns: {
      code: ["상품번호"],
      name: ["상품명"],
      image: ["이미지"],
      list: ["정상가"],
      discount: ["판매가"],
      net: ["공급단가"],
      status: ["판매상태"],
      brand: ["브랜드명"],
    },
    brandFilter: "폴바이스",
  },
};

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "") // 헤더 셀에 섞인 도움말 <a> 태그 등 제거
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** SpreadsheetML 2003 XML → 행 배열(셀 문자열). ss:Index 갭 처리. */
function parseSpreadsheetML(xml: string): string[][] {
  const rows: string[][] = [];
  for (const rowM of xml.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/g)) {
    const rowXml = rowM[1];
    const cells: string[] = [];
    let col = 0;
    for (const cellM of rowXml.matchAll(/<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/g)) {
      const attrs = cellM[1];
      const idxM = attrs.match(/ss:Index="(\d+)"/);
      if (idxM) col = parseInt(idxM[1], 10) - 1;
      const dataM = cellM[2].match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/);
      cells[col] = dataM ? decodeEntities(dataM[1]) : "";
      col++;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    rows.push(cells);
  }
  return rows;
}

function readRows(buf: Buffer, config: ParserConfig): string[][] {
  if (config.format === "spreadsheetml") {
    return parseSpreadsheetML(buf.toString("utf8"));
  }
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName =
    (config.sheetName && wb.SheetNames.includes(config.sheetName)
      ? config.sheetName
      : wb.SheetNames[0]) ?? wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
}

/** 헤더 행(정규화된 셀)에서 alias 에 맞는 컬럼 인덱스 찾기. */
function resolveCol(header: string[], aliases: Aliases): number {
  const norm = header.map((h) => decodeEntities(String(h ?? "")));
  for (const a of aliases) {
    const exact = norm.findIndex((h) => h === a);
    if (exact >= 0) return exact;
  }
  for (const a of aliases) {
    const partial = norm.findIndex((h) => h.startsWith(a) || h.includes(a));
    if (partial >= 0) return partial;
  }
  return -1;
}

export function parseChannelProductList(
  channel: PricingChannel,
  buf: Buffer,
): ChannelParseResult {
  const config = CONFIGS[channel as keyof typeof CONFIGS];
  if (!config) {
    return { channel, products: [], warnings: [`${channel} 는 엑셀 파서 대상이 아닙니다.`] };
  }

  const warnings: string[] = [];
  const rows = readRows(buf, config);
  if (rows.length === 0) {
    return { channel, products: [], warnings: ["빈 파일"] };
  }

  // 헤더 행 = 상품명 + 정가 alias 가 모두 잡히는 첫 행
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (resolveCol(rows[i], config.columns.name) >= 0 && resolveCol(rows[i], config.columns.list) >= 0) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return { channel, products: [], warnings: ["헤더(상품명/정가) 를 찾지 못함 — 포맷 확인 필요"] };
  }

  const header = rows[headerIdx];
  const col = {
    code: resolveCol(header, config.columns.code),
    name: resolveCol(header, config.columns.name),
    image: config.columns.image ? resolveCol(header, config.columns.image) : -1,
    list: resolveCol(header, config.columns.list),
    discount: resolveCol(header, config.columns.discount),
    net: resolveCol(header, config.columns.net),
    status: config.columns.status ? resolveCol(header, config.columns.status) : -1,
    brand: config.columns.brand ? resolveCol(header, config.columns.brand) : -1,
  };
  for (const [k, v] of Object.entries(col)) {
    if (["code", "name", "list", "discount", "net"].includes(k) && v < 0) {
      warnings.push(`필수 컬럼 '${k}' 를 찾지 못함`);
    }
  }

  const cell = (row: string[], idx: number): string =>
    idx >= 0 ? decodeEntities(String(row[idx] ?? "")) : "";

  const products: NormalizedChannelProduct[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    if (config.brandFilter && col.brand >= 0) {
      const b = cell(row, col.brand);
      if (b && !b.includes(config.brandFilter)) continue;
    }

    const name = cell(row, col.name);
    const code = cell(row, col.code);
    if (!name && !code) continue;

    products.push({
      channelCode: code || name,
      name,
      image: col.image >= 0 ? cell(row, col.image) || null : null,
      list: toNum(row[col.list]),
      discount: toNum(row[col.discount]),
      net: toNum(row[col.net]),
      status: col.status >= 0 ? cell(row, col.status) || null : null,
    });
  }

  if (products.length === 0) warnings.push("유효 상품 행 0건");
  return { channel, products, warnings };
}

/** 카카오+밴더 합산 정산율 (우리 실수령 = 할인가 × (1 − 이 값)). */
export const KAKAO_FEE_RATE = 0.3;

/**
 * 카카오선물 밴더(피오르드) 매출 분석 엑셀 → 가격 역산.
 *
 * 상품목록이 아니라 '월매출_YYYY' 시트(카카오코드/상품명/총수량/총매출)라, 팔린 상품은
 * 매출÷수량으로 할인가를 역산한다. 선물하기는 단일가라 정가=할인가로 본다.
 * net = 할인가 × (1 − KAKAO_FEE_RATE). 안 팔린(수량 0) 상품은 가격 없음으로 제외.
 */
export function parseKakaoGiftSales(buf: Buffer): ChannelParseResult {
  const warnings: string[] = [];
  const wb = XLSX.read(buf, { type: "buffer" });
  const salesSheets = wb.SheetNames.filter((n) => /^월매출_\d{4}$/.test(n)).sort().reverse();
  if (salesSheets.length === 0) {
    return { channel: "kakao_gift", products: [], warnings: ["월매출_YYYY 시트 없음 — 카카오 매출 엑셀 확인"] };
  }
  const sheet = salesSheets[0];
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet], { header: 1, defval: "" });

  // 헤더: row1 = [카카오코드, 상품명, 총 합계, ...], row2 = [,,판매수량,매출,...] → 데이터 row3+
  const products: NormalizedChannelProduct[] = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row?.[0] ?? "").trim();
    const name = String(row?.[1] ?? "").trim();
    if (!code && !name) continue;
    const qty = toNum(row?.[2]) ?? 0;
    const revenue = toNum(row?.[3]) ?? 0;
    if (qty <= 0 || revenue <= 0) {
      // 가격 역산 불가 — 코드/이름만 기록(가격 null)해 매칭 후보엔 남김
      products.push({ channelCode: code || name, name, image: null, list: null, discount: null, net: null, status: "판매없음" });
      continue;
    }
    const unit = Math.round(revenue / qty);
    products.push({
      channelCode: code || name,
      name,
      image: null,
      list: unit,
      discount: unit,
      net: Math.round(unit * (1 - KAKAO_FEE_RATE)),
      status: "판매중",
    });
  }

  if (products.length === 0) warnings.push("유효 행 0건");
  return { channel: "kakao_gift", products, warnings: [`출처 시트: ${sheet} (매출÷수량 역산)`, ...warnings] };
}
