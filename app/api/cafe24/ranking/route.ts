import { fetchAllOrders, buildRanking } from "@/lib/cafe24Data";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { NextResponse } from "next/server";

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function kstStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

// 카페24 Orders API는 한 번에 최대 1개월 범위만 허용
// → 월별로 나눠서 병렬 조회 후 합산
async function fetchOrdersForMonths(
  token: string,
  months: number
): Promise<any[]> {
  const now = kstNow();
  const todayStr = kstStr(now);

  // 각 조회 구간 생성: [startStr, endStr]
  const ranges: [string, string][] = [];

  for (let i = 0; i < months; i++) {
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(now.getUTCMonth() - i);

    const periodStart = new Date(periodEnd);
    periodStart.setUTCDate(1); // 해당 월 1일

    const startStr = kstStr(periodStart);
    const endStr   = i === 0 ? todayStr : kstStr(periodEnd);

    ranges.push([startStr, endStr]);
  }

  console.log("[ranking] 조회 구간:", ranges);

  // 병렬 조회
  const results = await Promise.all(
    ranges.map(([s, e]) => fetchAllOrders(token, s, e).catch((err) => {
      console.error(`[ranking] 구간 ${s}~${e} 실패:`, err.message);
      return [] as any[];
    }))
  );

  // 중복 제거 (같은 주문번호)
  const seen = new Set<string>();
  const all: any[] = [];
  for (const batch of results) {
    for (const order of batch) {
      const id = order.order_id ?? order.order_no ?? JSON.stringify(order);
      if (!seen.has(id)) {
        seen.add(id);
        all.push(order);
      }
    }
  }
  return all;
}

export async function GET() {
  const accessToken = await getValidC24Token();
  if (!accessToken) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  try {
    const orders   = await fetchOrdersForMonths(accessToken, 3);
    const products = buildRanking(orders, 10);

    const now = kstNow();
    const start = new Date(now);
    start.setUTCMonth(now.getUTCMonth() - 3);
    start.setUTCDate(1);

    console.log(`[ranking] 완료 - 주문 ${orders.length}건, 상품 ${products.length}개`);

    return NextResponse.json({
      products,
      period: { start: kstStr(start), end: kstStr(now) },
      totalOrders: orders.length,
    });
  } catch (e: any) {
    console.error("[ranking] error:", e);
    return NextResponse.json({ error: e.message ?? String(e) }, { status: 500 });
  }
}
