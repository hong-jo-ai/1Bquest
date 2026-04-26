import { type NextRequest } from "next/server";
import { parseExcelBuffer } from "@/lib/excelParser";
import { parseGroupBuyExcel } from "@/lib/groupBuyParser";

const ALLOWED_CHANNELS = [
  "wconcept",
  "musinsa",
  "29cm",
  "groupbuy",
  "sixshop",
  "naver_smartstore",
  "sixshop_global",
] as const;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel");
  if (!ALLOWED_CHANNELS.includes(channel as any)) {
    return Response.json({ error: "channel 파라미터가 없거나 잘못됐습니다 (wconcept | musinsa)" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return Response.json({ error: "file 필드가 없습니다" }, { status: 400 });
  }

  // 파일 크기 제한
  if (file.size > MAX_SIZE) {
    return Response.json({ error: "파일 크기는 10MB 이하만 가능합니다" }, { status: 413 });
  }

  // 확장자 확인
  if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
    return Response.json({ error: ".xlsx / .xls / .csv 파일만 업로드 가능합니다" }, { status: 415 });
  }

  try {
    const buffer = await file.arrayBuffer();
    // 공동구매는 집계 형태라 별도 파서 사용
    const result =
      channel === "groupbuy"
        ? parseGroupBuyExcel(buffer)
        : await parseExcelBuffer(buffer);
    return Response.json({
      ok: true,
      channel,
      fileName: file.name,
      ...result,
    });
  } catch (e) {
    const msg =
      e instanceof Error
        ? (e.message || `${e.name}: 메시지 없음 (${file.name}, ${file.size}바이트)`)
        : String(e);
    console.error("[upload] 파싱 실패:", file.name, file.size, "bytes —", msg);
    return Response.json({ error: msg }, { status: 422 });
  }
}
