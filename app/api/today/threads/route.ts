/**
 * POST /api/today/threads  { threadId, lastTouchedAt, closed }
 *
 * "최근 작업" 줄기를 끝난 것으로 닫거나 되살린다.
 * 클로드 코드 세션 파일만으로는 안 건드린 이유가 완료인지 방치인지 알 수 없어서,
 * 그 한 비트는 사람이 눌러서 알려준다.
 */
import type { NextRequest } from "next/server";
import { setThreadClosed } from "@/lib/today/activity";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { threadId?: unknown; lastTouchedAt?: unknown; closed?: unknown };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  const { threadId, lastTouchedAt, closed } = body;
  if (typeof threadId !== "string" || !threadId) {
    return Response.json({ ok: false, error: "threadId 필수" }, { status: 400 });
  }
  if (closed && typeof lastTouchedAt !== "string") {
    return Response.json({ ok: false, error: "닫을 때는 lastTouchedAt 필수" }, { status: 400 });
  }

  const r = await setThreadClosed(threadId, String(lastTouchedAt ?? ""), Boolean(closed));
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: 500 });
  return Response.json({ ok: true });
}
