import { getValidC24Token } from "@/lib/cafe24Auth";
import { cafe24Get } from "@/lib/cafe24Client";

function kstNow() { return new Date(Date.now() + 9 * 3_600_000); }
function kstStr(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET() {
  const token = await getValidC24Token();
  if (!token) return Response.json({ error: "토큰 없음" }, { status: 401 });

  const now = kstNow();
  const today = kstStr(now);
  const monthStart = kstStr(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));

  const results: Record<string, any> = {};

  // 1. 이번 달 주문 (limit=3으로 샘플만)
  try {
    const data = await cafe24Get(
      `/api/v2/admin/orders?start_date=${monthStart}&end_date=${today}&limit=3&embed=items`,
      token
    );
    const orders = data.orders ?? [];
    results.thisMonth = {
      count: orders.length,
      sample: orders.slice(0, 2).map((o: any) => ({
        order_id:      o.order_id,
        order_date:    o.order_date,
        payment_date:  o.payment_date,
        order_status:  o.order_status,
        total_amount:  o.total_amount,
        payment_amount: o.payment_amount,
        actual_payment_amount: o.actual_payment_amount,
        cancel_date:   o.cancel_date,
        items_count:   (o.items ?? []).length,
        allKeys:       Object.keys(o),
      })),
    };
  } catch (e: any) {
    results.thisMonth = { error: e.message };
  }

  // 2. 오늘 주문
  try {
    const data = await cafe24Get(
      `/api/v2/admin/orders?start_date=${today}&end_date=${today}&limit=5`,
      token
    );
    results.today = {
      count: (data.orders ?? []).length,
      totalAmount: (data.orders ?? []).reduce((s: number, o: any) =>
        s + parseFloat(o.total_amount ?? o.payment_amount ?? "0"), 0),
    };
  } catch (e: any) {
    results.today = { error: e.message };
  }

  // 3. 날짜 없이 호출 (기본값 확인)
  try {
    const data = await cafe24Get(`/api/v2/admin/orders?limit=1`, token);
    results.noDate = {
      count: (data.orders ?? []).length,
      sample: data.orders?.[0] ? {
        order_date: data.orders[0].order_date,
        total_amount: data.orders[0].total_amount,
      } : null,
    };
  } catch (e: any) {
    results.noDate = { error: e.message };
  }

  return Response.json({
    tokenOk: true,
    dates: { monthStart, today },
    results,
  }, { headers: { "Cache-Control": "no-store" } });
}
