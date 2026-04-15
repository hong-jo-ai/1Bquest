import { getCsSupabase } from "@/lib/cs/store";
import type { CsThread } from "@/lib/cs/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/cs/notifications
 * 사이드바 뱃지 + 상단 알림 벨용 통합 엔드포인트.
 * - unansweredCount: 미답변 총 개수
 * - recent: 최근 미답변 스레드 10건 (드롭다운 표시용)
 */
export async function GET() {
  try {
    const db = getCsSupabase();

    const { count } = await db
      .from("cs_threads")
      .select("id", { count: "exact", head: true })
      .eq("status", "unanswered");

    const { data, error } = await db
      .from("cs_threads")
      .select("*")
      .eq("status", "unanswered")
      .order("last_message_at", { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);

    return Response.json({
      unansweredCount: count ?? 0,
      recent: (data ?? []) as CsThread[],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
