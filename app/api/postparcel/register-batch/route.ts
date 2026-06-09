/**
 * 엑셀 파일접수 — 우체국송장양식(11컬럼) 업로드 → 파싱 → 로컬 에이전트 일괄 접수.
 * POST multipart { file }  (헤더: 수취인명/수취인 이동통신/수취인 전화번호/수취인 주소/
 *   수취인 우편번호/상품명/색상/수량/배송메세지/주문번호/판매처)
 *   → { success, total, ok, skipped, failed, results }
 * 컬럼은 헤더명으로 매핑(순서 무관), 못 찾으면 위치(0~10) fallback.
 */
import { type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { enqueueJob, getJob } from "@/lib/postParcel/queue";

export const dynamic = "force-dynamic";

// 헤더명 → row 키 (동의어 포함)
const COLS: Record<string, RegExp> = {
  name: /수취인\s*명|받는|수령인\s*명/,
  mobile: /이동통신|휴대|핸드폰|모바일/,
  tel: /전화/,
  addr: /주소/,
  zip: /우편번호|우편/,
  prod: /상품명|품명|상품/,
  color: /색상|컬러/,
  qty: /수량/,
  msg: /배송\s*메세지|배송\s*메시지|메모|요청/,
  order: /주문번호|주문/,
  seller: /판매처|채널|쇼핑몰/,
};
const POS = ["name", "mobile", "tel", "addr", "zip", "prod", "color", "qty", "msg", "order", "seller"];

export async function POST(req: NextRequest) {
  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
  } catch {
    return Response.json({ error: "파일 업로드 형식 오류" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "엑셀 파일을 첨부하세요" }, { status: 400 });

  let aoa: unknown[][];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }) as unknown[][];
  } catch (e) {
    return Response.json({ error: "엑셀 파싱 실패: " + (e as Error).message }, { status: 400 });
  }
  if (!aoa.length) return Response.json({ error: "빈 파일입니다" }, { status: 400 });

  // 헤더 → 컬럼 인덱스
  const header = (aoa[0] || []).map((h) => String(h || "").trim());
  const idx: Record<string, number> = {};
  for (const [key, re] of Object.entries(COLS)) {
    const i = header.findIndex((h) => re.test(h));
    idx[key] = i >= 0 ? i : POS.indexOf(key); // fallback 위치
  }

  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rows = aoa
    .slice(1)
    .filter((r) => Array.isArray(r) && r.some((c) => String(c).trim()))
    .map((r, i) => {
      const g = (k: string) => String(r[idx[k]] ?? "").trim();
      return {
        name: g("name"),
        mobile: g("mobile"),
        tel: g("tel"),
        addr: g("addr"),
        zip: g("zip"),
        prod: g("prod"),
        color: g("color"),
        qty: g("qty") || "1",
        msg: g("msg"),
        order: g("order") || `XLS-${ts}-${i + 1}`, // 주문번호 없으면 자동
        seller: g("seller") || "엑셀",
      };
    });

  if (!rows.length) return Response.json({ error: "데이터 행이 없습니다" }, { status: 400 });

  // 접수는 iMac 로컬에서만 가능 → 큐에 적재, 워커가 폴링해 실제 접수. 결과는 jobId 로 폴링.
  try {
    const jobId = await enqueueJob("batch", { rows });
    return Response.json({ queued: true, jobId, parsedRows: rows.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message || "접수 요청 적재 실패" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId 필요" }, { status: 400 });
  const job = await getJob(jobId);
  if (!job) return Response.json({ error: "해당 접수 요청을 찾을 수 없습니다" }, { status: 404 });
  return Response.json({ job });
}
