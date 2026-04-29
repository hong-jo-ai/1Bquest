/**
 * /api/today-hub/inbox
 *   GET                                → AI 가 needsReply=true 로 분류한 메일 목록 (사용자 처리된 건 제외)
 *   GET ?threadId=                     → 단일 스레드 상세 (모달용)
 *   POST { threadId, body }            → 답장 전송 (userReplied 자동 마킹)
 *   DELETE { messageId, reason? }      → '필요없음' 처리 (부정 사례 누적)
 */
import {
  listInboxItems, getThreadDetail, sendReplyToThread, markNotNeeded,
} from "@/lib/today-hub/gmailInbox";
import { getStatus } from "@/lib/today-hub/inboxStore";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");

  // 단일 스레드 상세
  if (threadId) {
    try {
      const detail = await getThreadDetail(threadId);
      if (!detail) return Response.json({ ok: false, error: "스레드 없음" }, { status: 404 });
      return Response.json({ ok: true, thread: detail });
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  // 목록 + 마지막 sync 상태
  try {
    const [items, status] = await Promise.all([listInboxItems(), getStatus()]);
    return Response.json({ ok: true, items, status });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  let body: { threadId?: string; body?: string };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!body.threadId || !body.body?.trim()) {
    return Response.json({ ok: false, error: "threadId, body 필수" }, { status: 400 });
  }

  const result = await sendReplyToThread(body.threadId, body.body);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error ?? "전송 실패" }, { status: 500 });
  }
  return Response.json({ ok: true, messageId: result.messageId });
}

export async function DELETE(req: NextRequest) {
  let body: { messageId?: string; reason?: string };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  if (!body.messageId) {
    return Response.json({ ok: false, error: "messageId 필수" }, { status: 400 });
  }

  const result = await markNotNeeded(body.messageId, body.reason);
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 500 });
  }
  return Response.json({ ok: true });
}
