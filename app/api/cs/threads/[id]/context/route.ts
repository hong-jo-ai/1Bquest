import { getCsSupabase, getThread } from "@/lib/cs/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/cs/threads/{id}/context
 * 해당 스레드의 발신자(customer_handle)와 같은 발신자의 다른 대화 이력을 반환.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const data = await getThread(id);
    if (!data) return Response.json({ error: "not found" }, { status: 404 });
    const { thread } = data;

    const db = getCsSupabase();
    let related: unknown[] = [];
    let totalThreads = 1;
    let firstContact = thread.created_at;

    if (thread.customer_handle) {
      const { data: rows } = await db
        .from("cs_threads")
        .select("id, brand, channel, subject, last_message_at, status, last_message_preview, created_at")
        .eq("customer_handle", thread.customer_handle)
        .neq("id", id)
        .order("last_message_at", { ascending: false })
        .limit(10);
      related = rows ?? [];

      const { count } = await db
        .from("cs_threads")
        .select("id", { count: "exact", head: true })
        .eq("customer_handle", thread.customer_handle);
      totalThreads = count ?? 1;

      const { data: firstRow } = await db
        .from("cs_threads")
        .select("created_at")
        .eq("customer_handle", thread.customer_handle)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstRow?.created_at) firstContact = firstRow.created_at;
    }

    return Response.json({
      related,
      totalThreads,
      firstContact,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
