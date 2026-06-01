/**
 * 모리 Tool Use — 위젯/차트 렌더 권한.
 *
 * 모리가 tool_use로 호출 → 서버에서 대시보드 데이터를 fetch → 위젯 스펙 생성.
 * 실행기는 { resultText, widget } 반환:
 *   - resultText: 모델에게 돌려줄 tool_result(짧은 요약). 모델이 이걸 근거로 말을 잇는다.
 *   - widget: SSE로 클라이언트에 푸시되어 패널에 렌더된다.
 *
 * Week 2: render_chart / render_metric_cards / clear_widgets. 데이터는 기존 대시보드 소스 재사용.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getDashboardData, type DashboardData } from "@/lib/cafe24Data";
import { listRecommendations } from "@/lib/mads/dbStore";
import { countThreadsByStatus } from "@/lib/cs/store";
import { loadInventoryFromStore } from "@/lib/inventorySync";
import type { WidgetEvent, ChartPoint, MetricCard } from "@/lib/mori/widgetTypes";

const won = (n: number) => "₩" + Math.round(n).toLocaleString("ko-KR");
const newId = () => `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "render_chart",
    description:
      "대시보드 데이터로 차트를 화면에 띄운다. 매출/주문 추이를 시각적으로 보여줄 때 사용. " +
      "사용자가 '보여줘/그려줘/추이/그래프'를 요청하거나, 추세 설명에 시각화가 도움될 때.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["revenue", "orders"], description: "매출 또는 주문수" },
        period: {
          type: "string",
          enum: ["daily_30d", "daily_14d", "hourly_today", "weekly"],
          description: "기간: 최근30일 일별 / 최근14일 일별 / 오늘 시간대별 / 이번주 요일별",
        },
        chart_type: { type: "string", enum: ["line", "bar"], description: "선택. 기본 line" },
        title: { type: "string", description: "선택. 차트 제목" },
      },
      required: ["metric", "period"],
    },
  },
  {
    name: "render_metric_cards",
    description:
      "핵심 지표를 KPI 카드로 띄운다. 매출/주문/CS/광고/재고 현황을 한눈에 보여줄 때 사용.",
    input_schema: {
      type: "object",
      properties: {
        metrics: {
          type: "array",
          items: {
            type: "string",
            enum: ["today_revenue", "month_revenue", "today_orders", "cs_unanswered", "ad_pending", "low_stock"],
          },
          description: "띄울 지표들",
        },
      },
      required: ["metrics"],
    },
  },
  {
    name: "clear_widgets",
    description: "화면의 모든 위젯/차트를 비운다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "query_inventory",
    description:
      "특정 제품의 현재 재고를 직접 조회한다(실시간 카페24). " +
      "사용자가 '○○ 재고 있어?/얼마 남았어?'처럼 특정 제품 재고를 물으면 query에 제품명 일부(예: '오드리', '에끌라')를 넣어 호출 — 일치 제품들의 재고 수량·상태를 돌려준다. " +
      "query 없이 filter로 전체/부족/품절 목록도 조회 가능. 재고를 답하기 전 이 도구로 확인하라.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "제품명 또는 SKU 일부(예: '오드리'). 특정 제품을 물을 때." },
        filter: {
          type: "string",
          enum: ["all", "low", "soldout"],
          description: "query가 없을 때 목록 필터. all=전체, low=부족(품절·위험·주의), soldout=품절만. 기본 low.",
        },
      },
    },
  },
  {
    name: "query_sales",
    description:
      "매출/주문 수치를 직접 조회한다(실시간 카페24). " +
      "사용자가 '오늘/이번주/이번달 매출', '최근 N일 추이', '오늘 잘나가는 상품'을 물을 때 사용. " +
      "수치를 답하기 전 이 도구로 확인하라.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month", "recent_days"],
          description: "조회 기간. recent_days는 일별 추이.",
        },
        days: { type: "number", description: "period=recent_days일 때 일수(기본 7, 최대 30)." },
        view: {
          type: "string",
          enum: ["summary", "top_products"],
          description: "summary=매출/주문 합계, top_products=오늘 잘나가는 상품 TOP5. 기본 summary.",
        },
      },
      required: ["period"],
    },
  },
];

let _cache: { data: DashboardData; at: number } | null = null;
/** 한 요청 처리 동안 대시보드 데이터를 재사용(여러 툴이 같은 데이터 필요). 15초 캐시. */
async function dashboard(): Promise<DashboardData | null> {
  if (_cache && Date.now() - _cache.at < 15_000) return _cache.data;
  const token = await getValidC24Token();
  if (!token) return null;
  const data = await getDashboardData(token, "paulvice");
  _cache = { data, at: Date.now() };
  return data;
}

async function buildChart(input: any): Promise<{ resultText: string; widget?: WidgetEvent }> {
  const metric: "revenue" | "orders" = input.metric;
  const period: string = input.period;
  const chartType: "line" | "bar" = input.chart_type === "bar" ? "bar" : "line";
  const unit = metric === "revenue" ? "원" : "건";

  const d = await dashboard();
  if (!d) return { resultText: "(카페24 데이터 불러오기 실패 — 차트 못 띄움)" };

  const mmdd = (iso: string) => iso.slice(5).replace("-", "/");
  let points: ChartPoint[] = [];
  let title: string = input.title ?? "";

  if (period === "daily_30d" || period === "daily_14d") {
    const n = period === "daily_30d" ? 30 : 14;
    points = d.dailyRevenue.slice(-n).map((r) => ({
      label: mmdd(r.date),
      value: metric === "revenue" ? r.revenue : r.orders,
    }));
    title ||= `최근 ${n}일 일별 ${metric === "revenue" ? "매출" : "주문"}`;
  } else if (period === "hourly_today") {
    points = d.hourlyOrders.map((h) => ({
      label: h.hour,
      value: metric === "revenue" ? h.revenue : h.orders,
    }));
    title ||= `오늘 시간대별 ${metric === "revenue" ? "매출" : "주문"}`;
  } else {
    points = d.weeklyRevenue.map((w) => ({
      label: w.day,
      value: metric === "revenue" ? w.revenue : w.orders,
    }));
    title ||= `이번주 요일별 ${metric === "revenue" ? "매출" : "주문"}`;
  }

  const vals = points.map((p) => p.value);
  const max = Math.max(0, ...vals);
  const sum = vals.reduce((a, b) => a + b, 0);
  const resultText =
    `${title} 차트를 띄웠습니다. 합계 ${metric === "revenue" ? won(sum) : sum + "건"}, ` +
    `최고 ${metric === "revenue" ? won(max) : max + "건"}.`;

  return { resultText, widget: { id: newId(), kind: "chart", chartType, title, unit, data: points } };
}

async function buildCards(input: any): Promise<{ resultText: string; widget?: WidgetEvent }> {
  const metrics: string[] = Array.isArray(input.metrics) ? input.metrics : [];
  const cards: MetricCard[] = [];
  const summary: string[] = [];

  const needDash = metrics.some((m) =>
    ["today_revenue", "month_revenue", "today_orders", "low_stock"].includes(m),
  );
  const d = needDash ? await dashboard().catch(() => null) : null;

  for (const m of metrics) {
    if (m === "today_revenue") {
      const v = d ? won(d.salesSummary.today.revenue) : "(실패)";
      cards.push({ label: "오늘 매출", value: v, tone: "neutral" });
      summary.push(`오늘 매출 ${v}`);
    } else if (m === "month_revenue") {
      const v = d ? won(d.salesSummary.month.revenue) : "(실패)";
      cards.push({ label: "이번 달 매출", value: v, sub: d ? `${d.salesSummary.month.orders}건` : undefined });
      summary.push(`이번달 ${v}`);
    } else if (m === "today_orders") {
      const v = d ? `${d.salesSummary.today.orders}건` : "(실패)";
      cards.push({ label: "오늘 주문", value: v });
      summary.push(`오늘 ${v}`);
    } else if (m === "low_stock") {
      const n = d ? d.inventory.filter((i) => i.status === "soldout" || i.status === "critical").length : null;
      cards.push({ label: "품절·위험 재고", value: n != null ? `${n}종` : "(실패)", tone: n && n > 0 ? "warn" : "good" });
      if (n != null) summary.push(`품절·위험 ${n}종`);
    } else if (m === "cs_unanswered") {
      const c = await countThreadsByStatus({ brand: "all" }).catch(() => null);
      const v = c ? `${c.unanswered}건` : "(실패)";
      cards.push({ label: "CS 미답변", value: v, sub: c ? `대기 ${c.waiting}` : undefined, tone: c && c.unanswered > 0 ? "warn" : "good" });
      if (c) summary.push(`미답변 ${v}`);
    } else if (m === "ad_pending") {
      const recs = await listRecommendations("pending", 50).catch(() => null);
      const v = recs ? `${recs.length}건` : "(실패)";
      cards.push({ label: "광고 추천 대기", value: v, tone: recs && recs.length > 0 ? "warn" : "neutral" });
      if (recs) summary.push(`광고추천 ${v}`);
    }
  }

  if (cards.length === 0) return { resultText: "(표시할 지표 없음)" };
  return {
    resultText: `지표 카드를 띄웠습니다: ${summary.join(", ")}.`,
    widget: { id: newId(), kind: "cards", cards },
  };
}

const statusKo = (s: string) =>
  s === "soldout" ? "품절" : s === "critical" ? "위험(3개 이하)" : s === "warning" ? "주의(10개 이하)" : "양호";

/** 재고 직접 조회 — 특정 제품(query) 또는 목록(filter). 위젯 없이 데이터만 모델에 돌려준다. */
async function queryInventory(input: any): Promise<{ resultText: string }> {
  const d = await dashboard();
  if (!d) return { resultText: "(카페24 재고 불러오기 실패 — 토큰 만료 가능)" };

  const entries = await loadInventoryFromStore().catch(
    (): Record<string, { discontinued?: boolean }> => ({}),
  );
  const discontinued = new Set(Object.keys(entries).filter((s) => entries[s].discontinued));
  const fmt = (i: DashboardData["inventory"][number]) =>
    `${i.name} (${i.sku}): 재고 ${i.stock}개 · ${statusKo(i.status)}${discontinued.has(i.sku) ? " · 단종" : ""}`;

  const q = String(input.query ?? "").trim().toLowerCase();
  if (q) {
    const matches = d.inventory.filter(
      (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
    );
    if (matches.length === 0) {
      return { resultText: `'${input.query}'와 일치하는 제품이 재고 목록에 없습니다. (전체 ${d.inventory.length}품목)` };
    }
    return { resultText: matches.map(fmt).join("\n") };
  }

  const filter = input.filter === "all" ? "all" : input.filter === "soldout" ? "soldout" : "low";
  let list = [...d.inventory].sort((a, b) => a.stock - b.stock);
  if (filter === "soldout") list = list.filter((i) => i.status === "soldout");
  else if (filter === "low") list = list.filter((i) => i.status !== "ok");
  if (list.length === 0) {
    return { resultText: filter === "all" ? "(상품 없음)" : "해당 조건의 제품 없음 (전 상품 양호)" };
  }
  const capped = list.slice(0, 40);
  const note = list.length > 40 ? `\n…외 ${list.length - 40}품목` : "";
  return { resultText: capped.map(fmt).join("\n") + note };
}

/** 매출/주문 직접 조회 — 기간 요약 / 일별 추이 / 오늘 잘나가는 상품. */
async function querySales(input: any): Promise<{ resultText: string }> {
  const d = await dashboard();
  if (!d) return { resultText: "(카페24 매출 불러오기 실패 — 토큰 만료 가능)" };

  if (input.view === "top_products") {
    const top = d.topProductsToday
      .slice(0, 5)
      .map((p) => `${p.rank}. ${p.name} ${p.sold}개 ${won(p.revenue)}`)
      .join("\n");
    return { resultText: top || "오늘 판매된 상품이 아직 없습니다." };
  }

  const s = d.salesSummary;
  const period = input.period;
  if (period === "today")
    return { resultText: `오늘: ${won(s.today.revenue)} · ${s.today.orders}건 (객단가 ${won(s.today.avgOrder)})` };
  if (period === "week")
    return { resultText: `이번 주: ${won(s.week.revenue)} · ${s.week.orders}건` };
  if (period === "month")
    return { resultText: `이번 달: ${won(s.month.revenue)} · ${s.month.orders}건 (전월 ${won(s.prevMonth.revenue)})` };

  // recent_days
  const n = Math.min(30, Math.max(1, Math.round(Number(input.days)) || 7));
  const slice = d.dailyRevenue.slice(-n);
  const rows = slice.map((r) => `${r.date}: ${won(r.revenue)} · ${r.orders}건`).join("\n");
  const sum = slice.reduce((a, r) => a + r.revenue, 0);
  return { resultText: `최근 ${n}일 일별\n${rows}\n합계 ${won(sum)}` };
}

/** tool_use 실행. 알 수 없는 툴은 안전 메시지 반환. */
export async function executeTool(
  name: string,
  input: any,
): Promise<{ resultText: string; widget?: WidgetEvent }> {
  try {
    if (name === "render_chart") return await buildChart(input);
    if (name === "render_metric_cards") return await buildCards(input);
    if (name === "clear_widgets") return { resultText: "위젯을 비웠습니다.", widget: { kind: "clear" } };
    if (name === "query_inventory") return await queryInventory(input);
    if (name === "query_sales") return await querySales(input);
    return { resultText: `(알 수 없는 툴: ${name})` };
  } catch (e: any) {
    return { resultText: `(툴 실행 실패: ${e?.message ?? "오류"})` };
  }
}
