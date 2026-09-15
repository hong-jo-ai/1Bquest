import { getThread } from "@/lib/cs/store";
import { getCustomerOrderHistory } from "@/lib/cs/customerOrders";
import { findLinkedThreads, type CrossChannelSummary, type LinkedThread } from "@/lib/cs/threadLinks";
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

    // 같은 고객의 다른 대화 — customer_handle 일치만으로는 채널을 못 넘는다(웹챗=전화,
    // 스마트스토어=마스킹, 메일=이메일). 주문번호·연락처·이름+상품으로 가로질러 묶는다.
    // 2026-09-15 손정원 건(웹챗↔스마트스토어 중복 응대) 이후 threadLinks 로 교체.
    let related: LinkedThread[] = [];
    let totalThreads = 1;
    let firstContact = thread.created_at;
    let crossChannel: CrossChannelSummary = { answeredElsewhere: [], unansweredElsewhere: [] };
    try {
      const links = await findLinkedThreads(id);
      related = links.related;
      crossChannel = links.crossChannel;
      totalThreads = 1 + related.length;
      const earliest = [thread.created_at, ...related.map((r) => r.created_at)]
        .filter(Boolean)
        .sort()[0];
      if (earliest) firstContact = earliest;
    } catch (e) {
      // 묶기 실패가 컨텍스트 전체를 막으면 안 된다 — 빈 목록으로 진행.
      console.warn("[cs/context] 관련 대화 매칭 실패:", e instanceof Error ? e.message : e);
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
      crossChannel,
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
