/**
 * 모리 메모 큐 API.
 *   GET            → 메모 목록
 *   POST {text}    → 메모 추가(받아쓰기 적재)
 *   DELETE ?id=    → 메모 삭제
 */

import { type NextRequest } from "next/server";
import { listMemos, addMemo, deleteMemo } from "@/lib/mori/memos";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ memos: await listMemos() });
}

export async function POST(req: NextRequest) {
  const { text } = (await req.json()) as { text?: string };
  const t = (text ?? "").trim();
  if (!t) return Response.json({ error: "text 비어있음" }, { status: 400 });
  const memo = await addMemo(t);
  return Response.json({ memo });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "id 없음" }, { status: 400 });
  await deleteMemo(id);
  return Response.json({ ok: true });
}
