import { getCsSupabase, getThread } from "@/lib/cs/store";
import { getCustomerOrderHistory } from "@/lib/cs/customerOrders";
import { careContextFor } from "@/lib/cs/careContext";

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

    // 문의 고객 ↔ 과거 주문(pp_shipments) 매칭 — 전화번호/이름 기준. 실패해도 컨텍스트는 반환.
    let orderHistory = null;
    try {
      orderHistory = await getCustomerOrderHistory({
        phone: thread.customer_handle,
        name: thread.customer_name,
      });
    } catch (e) {
      console.warn("[cs/context] 주문 매칭 실패:", e instanceof Error ? e.message : e);
    }

    // CARE 등록 여부 — 배터리 무료 1회가 남았는지를 상담 시작 시점에 바로 보여준다.
    // 실패해도 컨텍스트는 그대로 반환한다(조회 실패 ≠ 미등록).
    let care = null;
    try {
      care = await careContextFor({
        handle: thread.customer_handle,
        orderPhone: orderHistory?.phone,
        orderMatchedByPhone: !!orderHistory?.orders?.some((o) => o.matchedBy === "phone"),
      });
    } catch (e) {
      console.warn("[cs/context] CARE 조회 실패:", e instanceof Error ? e.message : e);
    }

    return Response.json({
      related,
      totalThreads,
      firstContact,
      orderHistory,
      care,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
