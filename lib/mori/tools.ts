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
import { addTodayTask } from "@/lib/todayHub/addTask";
import { createPurchaseOrder, restockEta } from "@/lib/purchaseOrders";
import { fetchAdSummary, todayKstDate } from "@/lib/mori/adsLive";
import { listCalendarEvents, TODAY_HUB_CALENDAR_ID } from "@/lib/today-hub/calendar";
import type { WidgetEvent, ChartPoint, MetricCard } from "@/lib/mori/widgetTypes";

/** KST 기준 오늘 날짜 YYYY-MM-DD. */
const todayKst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
  {
    name: "query_ads",
    description:
      "메타 광고 실적을 직접 조회한다(계정 단위, 실시간). 지출·노출·클릭·CTR·구매·ROAS. " +
      "'왜 주문이 없지?/광고 어때?/오늘 광고 돌고 있어?' 같은 질문에 추측 전에 이 도구로 확인하라. " +
      "노출·지출 0이면 광고 미집행, 노출은 있는데 구매 0이면 전환 문제로 진단한다.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "yesterday", "last_7d"],
          description: "조회 기간. 기본 today.",
        },
      },
    },
  },
  {
    name: "query_calendar",
    description:
      "대표님의 Google Calendar 일정을 직접 조회한다. " +
      "사용자가 '오늘 일정/내일 일정/이번 주 일정/캘린더 봐줘/몇 시 약속 있어?'처럼 일정을 물으면 사용. " +
      "기간을 특정하지 않으면 today로 조회한다. 조회 결과는 KST 기준이다.",
    input_schema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["today", "tomorrow", "next_7d"],
          description: "조회 기간. today=오늘, tomorrow=내일, next_7d=오늘 포함 7일. 기본 today.",
        },
      },
    },
  },
  {
    name: "add_task",
    description:
      "대시보드 '오늘 할일'에 새 할 일을 추가한다(즉시 반영, 되돌리기 쉬움). " +
      "사용자가 '~할일에 넣어줘 / 잊지 않게 적어줘'라고 하면 사용. 카테고리는 디자인/광고/CS/콘텐츠/운영/기타.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "할 일 제목 한 줄. 필수." },
        category: {
          type: "string",
          description: "디자인/광고/CS/콘텐츠/운영/기타 중 하나. 모르면 생략(기타).",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "create_purchase_order",
    description:
      "발주(재입고 주문)를 기록한다(내부 기록, 되돌리기 쉬움 — 실제 공급사 주문이 나가는 건 아님). " +
      "사용자가 '~ N개 발주 넣어줘/발주 기록해줘'라고 하면 사용. 발주일 미지정 시 오늘로 기록.",
    input_schema: {
      type: "object",
      properties: {
        product_name: { type: "string", description: "제품명. 필수." },
        qty: { type: "number", description: "발주 수량. 필수." },
        supplier: { type: "string", description: "공급사 (예: 나비스트). 선택." },
        unit_price: { type: "number", description: "단가(원). 선택." },
        order_date: { type: "string", description: "발주일 YYYY-MM-DD. 미지정 시 오늘." },
        notes: { type: "string", description: "메모. 선택." },
      },
      required: ["product_name", "qty"],
    },
  },
  {
    name: "propose_owner_telegram",
    description:
      "사장님(대표) 본인 텔레그램으로 메모/알림을 보낸다. 되돌릴 수 없으므로 바로 보내지 않고, " +
      "화면에 미리보기 확인 카드를 띄운다 — 사장님이 [실행]을 눌러야 실제 전송된다. " +
      "고객이 아니라 대표 본인에게만 간다. 리마인더·요약을 본인 폰으로 받고 싶어 할 때 사용.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "보낼 메시지 본문. 필수." },
      },
      required: ["text"],
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
  const fmt = (i: DashboardData["inventory"][number]) => {
    // tracked=false: 카페24 재고관리 미사용 → 수량 무의미, 판매중/품절로만.
    const qty =
      i.tracked === false
        ? i.status === "soldout"
          ? "품절"
          : "판매중(재고관리 안 함)"
        : `재고 ${i.stock}개 · ${statusKo(i.status)}`;
    return `${i.name} (${i.sku}): ${qty}${discontinued.has(i.sku) ? " · 단종" : ""}`;
  };

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
  const RANK: Record<string, number> = { soldout: 0, critical: 1, warning: 2, ok: 3 };
  let list = [...d.inventory].sort((a, b) => (RANK[a.status] - RANK[b.status]) || a.stock - b.stock);
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

/** 할일 추가 — 즉시 실행(되돌리기 쉬움). */
async function addTask(input: any): Promise<{ resultText: string }> {
  const r = await addTodayTask({ title: input.title, category: input.category });
  return { resultText: r.ok ? r.message : `(할일 추가 실패: ${r.error})` };
}

/** 발주 기록 — 즉시 실행(내부 기록, 되돌리기 쉬움). */
async function createPO(input: any): Promise<{ resultText: string }> {
  const name = String(input.product_name ?? "").trim();
  const qty = Math.round(Number(input.qty)) || 0;
  if (!name) return { resultText: "(발주 실패: 제품명 없음)" };
  if (qty <= 0) return { resultText: "(발주 실패: 수량은 1 이상)" };
  const po = await createPurchaseOrder({
    productName: name,
    qty,
    supplier: input.supplier ? String(input.supplier) : undefined,
    unitPrice: input.unit_price != null ? Number(input.unit_price) : undefined,
    orderDate: typeof input.order_date === "string" && input.order_date ? input.order_date : todayKst(),
    notes: input.notes ? String(input.notes) : undefined,
  });
  const eta = restockEta(po);
  const sup = po.supplier ? ` (${po.supplier})` : "";
  return {
    resultText: `발주 기록 완료: ${po.productName} ${po.qty}개${sup}. 발주일 ${po.orderDate}, 입고 예정 ${eta.start}~${eta.end}.`,
  };
}

/** 사장님 텔레그램 — 바로 보내지 않고 확인 카드를 띄운다. 실제 전송은 [실행] 클릭(→ /api/mori/action). */
function proposeOwnerTelegram(input: any): { resultText: string; widget?: WidgetEvent } {
  const text = String(input.text ?? "").trim();
  if (!text) return { resultText: "(보낼 내용이 비어 있습니다)" };
  return {
    resultText:
      "사장님 텔레그램으로 보낼 내용을 확인 카드로 띄웠습니다. 카드의 [실행]을 누르면 전송됩니다(아직 안 보냄).",
    widget: {
      id: newId(),
      kind: "confirm",
      title: "사장님 텔레그램 보내기",
      detail: text,
      confirmLabel: "전송",
      action: { type: "telegram_owner", params: { text } },
    },
  };
}

/** 메타 광고 실적 직접 조회 — 오늘/어제/최근7일. */
async function queryAds(input: any): Promise<{ resultText: string }> {
  const today = todayKstDate();
  let since = today;
  let until = today;
  let label = "오늘";
  if (input.period === "yesterday") {
    const y = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    since = until = y;
    label = "어제";
  } else if (input.period === "last_7d") {
    since = new Date(Date.now() + 9 * 60 * 60 * 1000 - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    label = "최근 7일";
  }

  const ad = await fetchAdSummary(since, until);
  if (!ad.ok) return { resultText: `(광고 조회 실패: ${ad.error})` };
  if (ad.spend === 0 && ad.impressions === 0) {
    return { resultText: `${label} 광고: 지출·노출 0 — 광고가 집행되지 않고 있습니다(중단/예산소진/심사반려 가능성).` };
  }
  return {
    resultText:
      `${label} 광고 — 지출 ${won(ad.spend)} · 노출 ${ad.impressions.toLocaleString("ko-KR")} · ` +
      `클릭 ${ad.clicks.toLocaleString("ko-KR")} · CTR ${ad.ctr.toFixed(2)}% · ` +
      `구매 ${ad.purchases}건 · 광고매출 ${won(ad.purchaseValue)} · ROAS ${ad.roas.toFixed(2)}`,
  };
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${date.slice(5).replace("-", "/")}(${WEEKDAYS[kst.getUTCDay()]})`;
}

/** Google Calendar 직접 조회 — 오늘/내일/최근 7일. */
async function queryCalendar(input: unknown): Promise<{ resultText: string }> {
  const obj = input && typeof input === "object" ? (input as { period?: unknown }) : {};
  const period =
    obj.period === "tomorrow" ? "tomorrow" : obj.period === "next_7d" ? "next_7d" : "today";
  const events = await listCalendarEvents({ period, maxResults: period === "next_7d" ? 50 : 20 });
  const label = period === "tomorrow" ? "내일" : period === "next_7d" ? "이번 7일" : "오늘";
  if (events.length === 0) {
    return { resultText: `${label} 일정 없음. 대상 캘린더: ${TODAY_HUB_CALENDAR_ID}` };
  }

  const rows = events.map((e) => {
    const loc = e.location ? ` @ ${e.location}` : "";
    const day = period === "next_7d" ? `${dateLabel(e.date)} ` : "";
    return `${day}${e.time} ${e.title}${loc}`;
  });
  return {
    resultText: `${label} 일정 (${events.length}건, KST)\n${rows.join("\n")}`,
  };
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
    if (name === "query_ads") return await queryAds(input);
    if (name === "query_calendar") return await queryCalendar(input);
    if (name === "add_task") return await addTask(input);
    if (name === "create_purchase_order") return await createPO(input);
    if (name === "propose_owner_telegram") return proposeOwnerTelegram(input);
    return { resultText: `(알 수 없는 툴: ${name})` };
  } catch (e: any) {
    return { resultText: `(툴 실행 실패: ${e?.message ?? "오류"})` };
  }
}
