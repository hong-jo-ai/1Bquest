import { type NextRequest } from "next/server";
import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get } from "@/lib/cafe24Client";
import { rankCandidates, type SkuRef } from "@/lib/channelPricing/match";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE = 15 * 1024 * 1024;

interface ParsedItem {
  productName: string;
  code?: string;       // 자체 상품코드 (PVJ... 등)
  qty: number;
  unitPrice?: number | null;
  amount?: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** 파일명에서 YYYYMMDD → YYYY-MM-DD 추출 (발주일 fallback). */
function dateFromName(name: string): string | null {
  const m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const PROMPT = `너는 발주제안서(생산발주서) 문서에서 발주 품목을 추출하는 파서다.
표에서 각 상품 행을 찾아 아래 JSON 으로만 응답하라. 합계/소계 행은 제외.
{
  "supplier": "공급사명 (없으면 빈 문자열)",
  "orderDate": "발주일 YYYY-MM-DD (문서에 있으면, 없으면 빈 문자열)",
  "items": [
    { "productName": "상품명", "code": "자체상품코드(있으면, 예 PVJ027SV)", "qty": 수량(정수), "unitPrice": 단가(숫자만), "amount": 금액(숫자만) }
  ]
}
수량/단가/금액은 숫자만(원화기호·콤마 제거). 모르면 null. 반드시 JSON 만.`;

async function geminiExtract(parts: Array<Record<string, unknown>>): Promise<{ supplier?: string; orderDate?: string; items: ParsedItem[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const client = new GoogleGenAI({ apiKey });
  const res = await client.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: PROMPT }, ...parts] as never }],
    config: { responseMimeType: "application/json", maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } },
  });
  const text = res.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { supplier?: string; orderDate?: string; items?: ParsedItem[] };
  return { supplier: parsed.supplier, orderDate: parsed.orderDate, items: parsed.items ?? [] };
}

async function loadSkuRefs(): Promise<SkuRef[]> {
  let token = await getValidC24Token();
  if (!token) token = await getAccessTokenFromStore();
  if (!token) return [];
  const refs: SkuRef[] = [];
  let offset = 0;
  for (let page = 0; page < 30; page++) {
    const d = (await cafe24Get(
      `/api/v2/admin/products?fields=product_code,product_name&limit=100&offset=${offset}&display=T`,
      token,
    )) as { products?: Array<{ product_code?: string; product_name?: string }> };
    const ps = d.products ?? [];
    for (const p of ps) if (p.product_code) refs.push({ sku: p.product_code, name: p.product_name ?? p.product_code });
    if (ps.length < 100) break;
    offset += 100;
  }
  return refs;
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ ok: false, error: "file 필드 없음" }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ ok: false, error: "15MB 이하만 가능" }, { status: 413 });

  const name = file.name.toLowerCase();
  try {
    const buf = Buffer.from(await file.arrayBuffer());

    let extracted: { supplier?: string; orderDate?: string; items: ParsedItem[] };
    if (name.endsWith(".pdf")) {
      extracted = await geminiExtract([{ inlineData: { mimeType: "application/pdf", data: buf.toString("base64") } }]);
    } else if (name.match(/\.(xlsx|xls|csv)$/)) {
      // 엑셀 → 텍스트 행으로 변환해 Gemini 에 전달 (포맷 다양성 대응)
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
      const tableText = rows.slice(0, 200).map((r) => r.join("\t")).join("\n");
      extracted = await geminiExtract([{ text: `다음은 발주서 표(탭 구분)다:\n${tableText}` }]);
    } else {
      return Response.json({ ok: false, error: "PDF / xlsx / xls / csv 만 가능" }, { status: 415 });
    }

    // SKU 이름 매칭
    const skuRefs = await loadSkuRefs();
    const items = extracted.items
      .filter((it) => it.productName?.trim() && (num(it.qty) ?? 0) > 0)
      .map((it) => {
        const cands = skuRefs.length ? rankCandidates(it.productName, skuRefs) : [];
        const best = cands[0]?.score === 1 ? cands[0].sku : "";
        return {
          productName: it.productName.trim(),
          code: it.code ?? "",
          qty: num(it.qty) ?? 0,
          unitPrice: num(it.unitPrice),
          amount: num(it.amount),
          sku: best,
          candidates: cands,
        };
      });

    const orderDate =
      (extracted.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(extracted.orderDate) ? extracted.orderDate : null) ??
      dateFromName(file.name) ??
      new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    return Response.json({ ok: true, supplier: extracted.supplier ?? "", orderDate, items, skus: skuRefs });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
