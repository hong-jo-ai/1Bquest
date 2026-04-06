/**
 * 정보수집 에이전트 (Data Collector)
 * - Cafe24 매출/주문, 재고 에이징, GA4, Meta 데이터 수집
 * - 기존 lib/ 클라이언트를 그대로 재사용
 */
import type { AgentTask, AgentResult, TaskEvent } from "../types";
import { createEvent } from "../orchestrator";

interface CollectedSnapshot {
  snapshot_date: string;
  cafe24: {
    today_revenue: number;
    today_orders: number;
    week_revenue: number;
    month_revenue: number;
    top_products: { product_no: number; name: string; sold: number; revenue: number }[];
  } | null;
  inventory: {
    total_skus: number;
    aging_urgent: string[];
    aging_critical: string[];
    low_stock: string[];
    products: {
      sku: string;
      name: string;
      currentStock: number;
      daysInStock: number;
      agingStatus: string;
      totalSold: number;
      initialStock: number;
    }[];
  } | null;
  errors: string[];
}

export async function runDataCollector(task: AgentTask): Promise<AgentResult> {
  const events: TaskEvent[] = [];
  const errors: string[] = [];
  const snapshot: CollectedSnapshot = {
    snapshot_date: new Date().toISOString(),
    cafe24: null,
    inventory: null,
    errors: [],
  };

  // 1. Cafe24 데이터 수집 (서버사이드 API 호출)
  try {
    const cafe24Res = await fetch(`${getBaseUrl()}/api/cafe24/data`, {
      headers: await getAuthHeaders(),
      cache: "no-store",
    });
    if (cafe24Res.ok) {
      const data = await cafe24Res.json();
      if (data.isReal) {
        snapshot.cafe24 = {
          today_revenue: data.salesSummary?.today?.revenue ?? 0,
          today_orders: data.salesSummary?.today?.orders ?? 0,
          week_revenue: data.salesSummary?.week?.revenue ?? 0,
          month_revenue: data.salesSummary?.month?.revenue ?? 0,
          top_products: (data.topProducts ?? []).slice(0, 10).map((p: { product_no: number; name: string; quantity: number; total: number }) => ({
            product_no: p.product_no,
            name: p.name,
            sold: p.quantity,
            revenue: p.total,
          })),
        };
      }
    }
  } catch (e: unknown) {
    errors.push(`Cafe24: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. 재고 데이터 수집 (KV에서 로드)
  try {
    const invRes = await fetch(`${getBaseUrl()}/api/store?key=paulvice_inventory_v1`, {
      cache: "no-store",
    });
    const { data: inventoryEntries } = await invRes.json();

    const prodRes = await fetch(`${getBaseUrl()}/api/store?key=paulvice_manual_products_v1`, {
      cache: "no-store",
    });
    const { data: manualProducts } = await prodRes.json();

    if (inventoryEntries || manualProducts) {
      const entries: Record<string, { sku: string; initialStock: number; stockInDate: string; manualAdjustment: number }> =
        inventoryEntries ?? {};
      const products: { sku: string; name: string }[] = manualProducts ?? [];

      const now = new Date();
      const inventoryProducts = Object.entries(entries).map(([sku, entry]) => {
        const prod = products.find((p) => p.sku === sku);
        const daysInStock = entry.stockInDate
          ? Math.floor((now.getTime() - new Date(entry.stockInDate).getTime()) / 86400000)
          : 0;
        const currentStock = Math.max(0, (entry.initialStock || 0) + (entry.manualAdjustment || 0));
        const agingStatus =
          currentStock === 0 ? "normal" :
          daysInStock >= 180 ? "critical" :
          daysInStock >= 90 ? "urgent" :
          daysInStock >= 60 ? "caution" : "normal";

        return {
          sku,
          name: prod?.name ?? sku,
          currentStock,
          daysInStock,
          agingStatus,
          totalSold: 0,
          initialStock: entry.initialStock || 0,
        };
      });

      snapshot.inventory = {
        total_skus: inventoryProducts.length,
        aging_urgent: inventoryProducts.filter((p) => p.agingStatus === "urgent").map((p) => p.sku),
        aging_critical: inventoryProducts.filter((p) => p.agingStatus === "critical").map((p) => p.sku),
        low_stock: inventoryProducts.filter((p) => p.currentStock > 0 && p.currentStock < 10).map((p) => p.sku),
        products: inventoryProducts,
      };
    }
  } catch (e: unknown) {
    errors.push(`Inventory: ${e instanceof Error ? e.message : String(e)}`);
  }

  snapshot.errors = errors;

  // 이벤트 발행
  events.push(createEvent("data.refreshed", "data-collector", {
    cafe24_ok: !!snapshot.cafe24,
    inventory_ok: !!snapshot.inventory,
    error_count: errors.length,
  }));

  // 이상 감지
  if (snapshot.inventory) {
    const { aging_urgent, aging_critical } = snapshot.inventory;
    if (aging_urgent.length > 0 || aging_critical.length > 0) {
      events.push(createEvent("data.anomaly.detected", "data-collector", {
        type: "inventory_aging",
        urgent_count: aging_urgent.length,
        critical_count: aging_critical.length,
        skus: [...aging_urgent, ...aging_critical],
      }));
    }
  }

  return {
    agentId: "data-collector",
    taskId: task.id,
    status: errors.length > 0 && !snapshot.cafe24 && !snapshot.inventory ? "error" : "success",
    output: snapshot as unknown as Record<string, unknown>,
    events,
    timestamp: new Date().toISOString(),
  };
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  // API 라우트에서 호출할 때는 쿠키를 전달해야 함
  // 서버사이드에서는 cookies()를 직접 사용
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join("; ");
    return { Cookie: cookieHeader };
  } catch {
    return {};
  }
}
