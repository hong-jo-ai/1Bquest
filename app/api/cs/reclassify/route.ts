import { getCsSupabase } from "@/lib/cs/store";
import { classifyEmail } from "@/lib/cs/classifier";
import type { CsBrandId } from "@/lib/cs/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ThreadRow {
  id: string;
  brand: CsBrandId;
  channel: string;
  customer_handle: string | null;
  customer_name: string | null;
  subject: string | null;
}

interface MessageRow {
  body_text: string | null;
}

/**
 * POST /api/cs/reclassify
 * 현재 unanswered 상태인 모든 Gmail/일반 채널 스레드를 다시 분류한다.
 * - customer_inquiry 가 아니면 archived 로 전환
 * - 식스샵·카페24 게시판은 분류기 건너뜀
 *
 * 비용 관리: 한 번에 최대 200건까지만 처리.
 */
export async function POST() {
  const db = getCsSupabase();

  const { data: threads, error } = await db
    .from("cs_threads")
    .select("id, brand, channel, customer_handle, customer_name, subject")
    .eq("status", "unanswered")
    .neq("channel", "threads") // Threads는 제외 (분류기는 이메일용)
    .order("last_message_at", { ascending: false })
    .limit(200);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const list = (threads ?? []) as ThreadRow[];
  let archived = 0;
  let kept = 0;
  let failed = 0;

  for (const t of list) {
    try {
      // 가장 최근 in-direction 메시지 본문을 가져옴
      const { data: msgs } = await db
        .from("cs_messages")
        .select("body_text")
        .eq("thread_id", t.id)
        .eq("direction", "in")
        .order("sent_at", { ascending: false })
        .limit(1);
      const last = (msgs?.[0] ?? null) as MessageRow | null;

      const cls = await classifyEmail({
        brand: t.brand,
        fromName: t.customer_name,
        fromEmail: t.customer_handle,
        subject: t.subject ?? "",
        bodySnippet: last?.body_text ?? "",
      });

      if (!cls.isCs) {
        await db
          .from("cs_threads")
          .update({ status: "archived" })
          .eq("id", t.id);
        archived++;
      } else {
        kept++;
      }
    } catch {
      failed++;
    }
  }

  return Response.json({
    ok: true,
    processed: list.length,
    archived,
    kept,
    failed,
  });
}
