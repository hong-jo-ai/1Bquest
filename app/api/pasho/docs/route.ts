import { type NextRequest } from "next/server";
import { addDoc, listDocs, DOC_KINDS, type DocKind } from "@/lib/pasho/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX = 30 * 1024 * 1024; // 30MB — 스캔 PDF·사진 여유
const ALLOWED = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

/** GET /api/pasho/docs?orderNo=P26-001 — 증빙 목록(파일 원본은 /:id/file 로 따로) */
export async function GET(req: NextRequest) {
  const orderNo = req.nextUrl.searchParams.get("orderNo") || undefined;
  try {
    return Response.json({ ok: true, docs: await listDocs(orderNo) });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * POST /api/pasho/docs  (multipart)
 *   file, orderNo, kind, title?, docDate?, currency?, supplyAmount?, vat?, totalAmount?, note?
 * 대시보드 증빙 섹션의 첨부 버튼이 쓰는 경로.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ ok: false, error: "form 파싱 실패" }, { status: 400 }); }

  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ ok: false, error: "파일이 없습니다" }, { status: 400 });
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.includes(mime)) {
    return Response.json({ ok: false, error: `지원 형식: 사진(JPG/PNG/WEBP/HEIC)·PDF·엑셀 (받은 형식: ${mime})` }, { status: 415 });
  }
  if (file.size > MAX) return Response.json({ ok: false, error: "30MB 이하만 가능합니다" }, { status: 413 });

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const num = (k: string) => {
    const v = str(k);
    if (!v) return null;
    const n = Number(v.replace(/[,\s₩$]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const kind = (str("kind") || "기타") as DocKind;
  if (!DOC_KINDS.includes(kind)) return Response.json({ ok: false, error: "알 수 없는 증빙 종류" }, { status: 400 });

  try {
    const doc = await addDoc(
      { buffer: Buffer.from(await file.arrayBuffer()), mime, filename: file.name },
      {
        orderNo: str("orderNo") || "미분류",
        kind,
        title: str("title") || file.name || kind,
        source: "web",
        docDate: str("docDate"),
        currency: (str("currency") as "KRW" | "USD" | null) || null,
        supplyAmount: num("supplyAmount"),
        vat: num("vat"),
        totalAmount: num("totalAmount"),
        note: str("note"),
      },
    );
    return Response.json({ ok: true, doc });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
