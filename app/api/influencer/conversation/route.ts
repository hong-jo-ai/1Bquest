/**
 * 인플루언서의 실제 인스타 DM 대화 조회.
 *
 * 인플루언서 handle(@paulvice.kr로 온 IG DM) 로 CS 인박스(cs_threads/cs_messages,
 * channel='ig_dm', brand='paulvice')를 조회해 진짜 대화 내역을 돌려준다.
 * - hasThread: 실제 대화가 있는지(= 상대가 우리에게 DM 보낸 적 있는지)
 * - canApiReply: 최근 인바운드가 24시간 이내인지(=API 답장 가능 창)
 * - igsid: 최근 인바운드 발신자 IGSID(답장 대상)
 */
import { type NextRequest } from "next/server";
import { getCsSupabase } from "@/lib/cs/store";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const handle = String(req.nextUrl.searchParams.get("handle") ?? "")
    .replace(/^@/, "")
    .trim();
  if (!handle) return Response.json({ ok: false, error: "handle 필요" }, { status: 400 });

  const db = getCsSupabase();

  const { data: threads, error: tErr } = await db
    .from("cs_threads")
    .select("id, last_message_at")
    .eq("channel", "ig_dm")
    .eq("brand", "paulvice")
    .ilike("customer_handle", handle);
  if (tErr) return Response.json({ ok: false, error: tErr.message }, { status: 500 });

  if (!threads?.length) {
    return Response.json({ ok: true, hasThread: false, messages: [], canApiReply: false });
  }

  const threadIds = threads.map((t) => t.id);
  const { data: rows, error: mErr } = await db
    .from("cs_messages")
    .select("direction, body_text, sent_at, raw")
    .in("thread_id", threadIds)
    .order("sent_at", { ascending: true });
  if (mErr) return Response.json({ ok: false, error: mErr.message }, { status: 500 });

  const all = rows ?? [];
  const messages = all
    .filter((m) => (m.body_text ?? "").toString().trim())
    .map((m) => ({
      direction: m.direction as "in" | "out",
      text: m.body_text as string,
      sentAt: m.sent_at as string,
    }));

  // 최근 인바운드 → IGSID + 24h 창 판정
  let igsid: string | undefined;
  let lastInboundAt: string | undefined;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].direction === "in") {
      const raw = all[i].raw as { from?: { id?: string } } | null;
      igsid = raw?.from?.id;
      lastInboundAt = all[i].sent_at as string;
      break;
    }
  }
  const canApiReply =
    !!lastInboundAt && Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS;

  return Response.json({
    ok: true,
    hasThread: true,
    threadId: threadIds[0],
    messages,
    igsid,
    lastInboundAt,
    canApiReply,
  });
}
