/**
 * 인플루언서 답장 단계 앱내 DM 발송 (@paulvice.kr).
 *
 * 정책: 인스타 메시징 API는 "상대가 먼저 보낸" 대화에만, 보통 24시간 이내 답장만 허용.
 * 따라서 인플루언서가 @paulvice.kr로 먼저 메시지(답장)를 보낸 경우에만 보낼 수 있다.
 * 첫 콜드 DM은 이 경로로 못 보낸다(수동).
 *
 * 핸들 → IGSID 해석: 인플루언서가 답장하면 그 메시지가 CS 인박스(cs_threads/cs_messages,
 * channel='ig_dm', brand='paulvice')로 들어온다. 거기서 customer_handle 매칭 → 인바운드
 * 메시지의 raw.from.id(=상대 IGSID)를 꺼내 전송한다.
 */
import { type NextRequest } from "next/server";
import { getCsSupabase } from "@/lib/cs/store";
import { listIgAccounts, sendIgMessage } from "@/lib/cs/instagramClient";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { handle?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 });
  }

  const handle = String(body.handle ?? "").replace(/^@/, "").trim();
  const text = String(body.text ?? "").trim();
  if (!handle) return Response.json({ ok: false, error: "handle 필요" }, { status: 400 });
  if (!text) return Response.json({ ok: false, error: "보낼 내용이 비어 있습니다" }, { status: 400 });

  // 1) 폴바이스 인스타 계정(활성=@paulvice.kr)
  let account;
  try {
    const accounts = await listIgAccounts();
    account = accounts.find((a) => a.brand === "paulvice");
  } catch (e: any) {
    return Response.json({ ok: false, error: `계정 조회 실패: ${e?.message ?? "오류"}` }, { status: 500 });
  }
  if (!account) {
    return Response.json(
      { ok: false, error: "폴바이스 인스타(@paulvice.kr)가 CS에 연결돼 있지 않습니다." },
      { status: 400 },
    );
  }

  const db = getCsSupabase();

  // 2) 핸들 → IGSID (CS ig_dm 대화에서)
  const { data: threads, error: tErr } = await db
    .from("cs_threads")
    .select("id, last_message_at")
    .eq("channel", "ig_dm")
    .eq("brand", "paulvice")
    .ilike("customer_handle", handle);
  if (tErr) return Response.json({ ok: false, error: `대화 조회 실패: ${tErr.message}` }, { status: 500 });
  if (!threads?.length) {
    return Response.json(
      {
        ok: false,
        code: "NO_CONVERSATION",
        error: `@${handle}님이 아직 @paulvice.kr로 메시지를 보낸 적이 없어요. 인스타 정책상 첫 DM은 직접(수동) 보내야 하고, 상대가 답장한 뒤부터 앱에서 바로 보낼 수 있어요.`,
      },
      { status: 409 },
    );
  }

  const threadIds = threads.map((t) => t.id);
  const { data: msgs, error: mErr } = await db
    .from("cs_messages")
    .select("raw")
    .in("thread_id", threadIds)
    .eq("direction", "in")
    .order("sent_at", { ascending: false })
    .limit(1);
  if (mErr) return Response.json({ ok: false, error: `메시지 조회 실패: ${mErr.message}` }, { status: 500 });

  const raw = msgs?.[0]?.raw as { from?: { id?: string } } | undefined;
  const igsid = raw?.from?.id;
  if (!igsid) {
    return Response.json(
      { ok: false, code: "NO_IGSID", error: "상대 인스타 ID를 찾지 못했어요. 대화는 있는데 수신 메시지가 없습니다." },
      { status: 409 },
    );
  }

  // 3) 전송 (RESPONSE — 24시간 답장 윈도우)
  try {
    const { message_id } = await sendIgMessage(account, igsid, text);
    return Response.json({ ok: true, messageId: message_id, account: account.displayName });
  } catch (e: any) {
    // 윈도우 초과/권한 등 IG 오류를 그대로 전달
    return Response.json(
      {
        ok: false,
        code: "IG_SEND_FAILED",
        error:
          "인스타 전송이 거부됐어요. 답장 후 24시간이 지났거나(윈도우 초과) 권한 문제일 수 있어요. " +
          `상세: ${e?.message ?? "오류"}`,
      },
      { status: 502 },
    );
  }
}
