/**
 * /api/today-hub/inbox
 *   GET                                → 답장필요 라벨 스레드 목록
 *   GET ?accountId=&threadId=          → 단일 스레드 상세
 *   POST { accountId, threadId, body } → 답장 전송 + 라벨 제거
 *   DELETE { accountId, threadId }     → 라벨만 제거 (답장 완료 표시)
 */
import {
  listReplyNeededThreads,
  getThreadDetail,
  sendReplyAndUnlabel,
  unlabelThread,
} from "@/lib/today-hub/gmailInbox";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId");
  const threadId  = req.nextUrl.searchParams.get("threadId");

  // 단일 스레드 상세
  if (accountId && threadId) {
    try {
      const detail = await getThreadDetail(accountId, threadId);
      if (!detail) return Response.json({ ok: false, error: "스레드 없음" }, { status: 404 });
      return Response.json({ ok: true, thread: detail });
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  // 목록
  try {
    const items = await listReplyNeededThreads();
    return Response.json({ ok: true, items });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { accountId?: string; threadId?: string; body?: string };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!body.accountId || !body.threadId || !body.body?.trim()) {
    return Response.json({ ok: false, error: "accountId, threadId, body 필수" }, { status: 400 });
  }

  const result = await sendReplyAndUnlabel(body.accountId, body.threadId, body.body);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error ?? "전송 실패" }, { status: 500 });
  }
  return Response.json({ ok: true, messageId: result.messageId });
}

export async function DELETE(req: NextRequest) {
  let body: { accountId?: string; threadId?: string };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!body.accountId || !body.threadId) {
    return Response.json({ ok: false, error: "accountId, threadId 필수" }, { status: 400 });
  }

  try {
    await unlabelThread(body.accountId, body.threadId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
