/**
 * 마켓플레이스 무인 적재 — 다운로드한 주문 엑셀을 파싱 + 영속 저장(한 번에).
 *
 * 로컬 에이전트의 크론(runMusinsaSync.js)이 호출. 토큰 인증(x-agent-token)이라
 * 세션 없이 접근 가능(proxy ALLOW_PREFIX의 /api/marketplace/ 우회). 인터랙티브
 * 업로드와 동일한 channel_upload:{channel} 저장소를 공유한다.
 *
 * POST /api/marketplace/sync-ingest?channel=musinsa   (multipart: file)
 * 헤더: x-agent-token: <PAULWISE_MCP_TOKEN>
 */
import { type NextRequest } from "next/server";
import { parseExcelBuffer } from "@/lib/excelParser";
import { storeChannelUpload } from "@/lib/profit/channelUploadStore";
import { type UploadableChannel } from "@/lib/multiChannelData";

export const dynamic = "force-dynamic";

const ALLOWED: UploadableChannel[] = [
  "wconcept",
  "musinsa",
  "29cm",
  "groupbuy",
  "kakao_gift",
  "lotte_dutyfree",
  "shinsegae_dutyfree",
  "sixshop",
  "naver_smartstore",
  "sixshop_global",
];

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const channel = req.nextUrl.searchParams.get("channel") as UploadableChannel | null;
  if (!channel || !ALLOWED.includes(channel)) {
    return Response.json({ error: `허용되지 않은 channel: ${channel}` }, { status: 400 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
  } catch {
    return Response.json({ error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }
  if (!file) return Response.json({ error: "file 필드 없음" }, { status: 400 });
  if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
    return Response.json({ error: ".xlsx/.xls/.csv 만 허용" }, { status: 415 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const result = await parseExcelBuffer(buffer);
    const meta = {
      fileName: file.name,
      rowCount: result.rowCount,
      period: result.period,
      uploadedAt: new Date().toISOString(),
    };
    await storeChannelUpload(channel, result.data, meta);
    return Response.json({
      ok: true,
      channel,
      fileName: file.name,
      rowCount: result.rowCount,
      period: result.period,
      columns: result.columns,
      data: result.data, // 대시보드 미리보기용
      stored: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync-ingest] 실패:", channel, file.name, "—", msg);
    return Response.json({ error: msg }, { status: 422 });
  }
}
