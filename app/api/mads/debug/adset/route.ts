/**
 * /api/mads/debug/adset?id=METAADSET_ID&days=14
 *
 * MADS 보정 ROAS 가 이상할 때 진단용 — Meta 의 action_values 원본을 attribution 별로 노출하고
 * 같은 기간 카페24 주문 합계와 비교해서 데이터 왜곡 원인을 찾는 용도.
 *
 * 응답:
 *   - meta.daily[]: 일별 spend, action_types 별 raw value, attribution window 별 breakdown
 *   - meta.summary: 7일/14일 합계 (단순 sum / max)
 *   - cafe24.orders[]: 같은 기간 카페24 주문 (실제 발생한 매출)
 *   - cafe24.summary: 주문 수, 총 매출
 *   - diagnosis: 의심 패턴 자동 탐지 (단일 값 1M 초과, action_type 간 차이 등)
 */
import { metaGet } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { fetchAllOrders } from "@/lib/cafe24Data";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ActionWithWindow {
  action_type: string;
  value: string;
  "1d_click"?: string;
  "7d_click"?: string;
  "1d_view"?: string;
  "7d_view"?: string;
}
interface InsightRow {
  date_start?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: ActionWithWindow[];
  action_values?: ActionWithWindow[];
}

const PURCHASE_TYPES = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

function num(v: string | undefined): number {
  return parseFloat(v ?? "0") || 0;
}

export async function GET(req: NextRequest) {
  const adsetId = req.nextUrl.searchParams.get("id");
  const days    = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") ?? "14", 10)));
  if (!adsetId) {
    return Response.json({ ok: false, error: "id 파라미터 필수" }, { status: 400 });
  }

  const metaToken = await getMetaTokenServer();
  if (!metaToken) {
    return Response.json({ ok: false, error: "Meta 미연결" }, { status: 500 });
  }

  const since = new Date(Date.now() - (days - 1) * 86400000);
  const sinceStr = since.toISOString().slice(0, 10);
  const untilStr = new Date().toISOString().slice(0, 10);

  // Meta raw — attribution window breakdown 포함
  let meta: { daily: unknown[]; summary: unknown; raw: unknown; adset?: unknown } = {
    daily: [],
    summary: {},
    raw: null,
  };
  try {
    const ins = (await metaGet(`/${adsetId}/insights`, metaToken, {
      fields: "spend,impressions,clicks,actions,action_values",
      time_range: JSON.stringify({ since: sinceStr, until: untilStr }),
      time_increment: "1",
      level: "adset",
      action_attribution_windows: JSON.stringify(["1d_click", "7d_click", "1d_view", "7d_view"]),
    })) as { data?: InsightRow[] };

    const adsetMeta = (await metaGet(`/${adsetId}`, metaToken, {
      fields: "id,name,status,daily_budget,campaign{name},account{name}",
    })) as Record<string, unknown>;

    let totalSpend = 0;
    let maxSinglePurchaseValue = 0;
    let totalRevenueSum = 0;       // 모든 action_values 단순 합 (overcounting 가능)
    let totalRevenueMaxPerDay = 0; // sumPurchase 방식 (max per attribution)

    const daily = (ins.data ?? []).map((r) => {
      const spend = num(r.spend);
      totalSpend += spend;

      // 모든 action_types 노출 — purchase 외에 add_to_cart, view_content 등도 포함
      const allActions = (r.actions ?? []).map((a) => ({
        action_type: a.action_type,
        value:       num(a.value),
        win:         { d1c: num(a["1d_click"]), d7c: num(a["7d_click"]), d1v: num(a["1d_view"]), d7v: num(a["7d_view"]) },
      }));
      const allActionValues = (r.action_values ?? []).map((a) => ({
        action_type: a.action_type,
        value:       num(a.value),
        win:         { d1c: num(a["1d_click"]), d7c: num(a["7d_click"]), d1v: num(a["1d_view"]), d7v: num(a["7d_view"]) },
      }));

      // 그날 최대 단일 attribution 값 (오염 식별용)
      const maxThisDay = allActionValues
        .filter((a) => PURCHASE_TYPES.has(a.action_type))
        .reduce((m, a) => Math.max(m, a.value, a.win.d1c, a.win.d7c, a.win.d1v, a.win.d7v), 0);
      maxSinglePurchaseValue = Math.max(maxSinglePurchaseValue, maxThisDay);

      // sumPurchase 와 같은 로직 — purchase 계열 중 max
      const dayRevMax = allActionValues
        .filter((a) => PURCHASE_TYPES.has(a.action_type))
        .reduce((m, a) => Math.max(m, a.value), 0);
      totalRevenueMaxPerDay += dayRevMax;

      // 단순 합 (overcount 가능)
      const daySumAll = allActionValues
        .filter((a) => PURCHASE_TYPES.has(a.action_type))
        .reduce((s, a) => s + a.value, 0);
      totalRevenueSum += daySumAll;

      return {
        date:        r.date_start,
        spend,
        impressions: num(r.impressions),
        clicks:      num(r.clicks),
        actions:        allActions,
        action_values:  allActionValues,
        dayRevMax,         // 이 날의 매출 (sumPurchase 방식)
        daySumAll,         // 단순 sum (검증용)
      };
    });

    meta = {
      adset:   adsetMeta,
      daily,
      summary: {
        days,
        spend:                totalSpend,
        revenueMaxPerDay:     totalRevenueMaxPerDay,   // MADS 가 ROAS 계산할 때 쓰는 값
        revenueSimpleSum:     totalRevenueSum,         // overcount 의심 검증용
        roas:                 totalSpend > 0 ? totalRevenueMaxPerDay / totalSpend : 0,
        maxSinglePurchaseValue,                         // 가장 큰 단일 attribution value
      },
      raw: ins.data ?? [],
    };
  } catch (e) {
    return Response.json({ ok: false, error: `Meta API: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  // Cafe24 주문 — 같은 기간 실제 발생한 폴바이스 주문
  let cafe24: { orders: unknown[]; summary: unknown; warning?: string } = { orders: [], summary: {} };
  try {
    const c24Token = await getValidC24Token();
    if (!c24Token) {
      cafe24.warning = "Cafe24 미연결 — 비교 생략";
    } else {
      const orders = (await fetchAllOrders(c24Token, sinceStr, untilStr, false)) as Array<{
        order_id?: string;
        order_date?: string;
        ordered_date?: string;
        payment_amount?: string;
        total_amount?: string;
        paid_amount?: string;
        order_price_amount?: string;
      }>;
      const flat = orders.map((o) => ({
        order_id: o.order_id,
        date:     o.ordered_date ?? o.order_date,
        amount:   num(o.payment_amount ?? o.paid_amount ?? o.total_amount ?? o.order_price_amount),
      })).filter((o) => o.amount > 0);
      flat.sort((a, b) => b.amount - a.amount);
      cafe24 = {
        orders: flat,
        summary: {
          count:     flat.length,
          total:     flat.reduce((s, o) => s + o.amount, 0),
          maxOrder:  flat[0]?.amount ?? 0,
          top5Total: flat.slice(0, 5).reduce((s, o) => s + o.amount, 0),
        },
      };
    }
  } catch (e) {
    cafe24.warning = `Cafe24 조회 실패: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 자동 진단 메시지
  const summary = meta.summary as {
    spend: number;
    revenueMaxPerDay: number;
    revenueSimpleSum: number;
    roas: number;
    maxSinglePurchaseValue: number;
  };
  const c24Total = (cafe24.summary as { total?: number })?.total ?? 0;
  const diagnosis: string[] = [];
  if (summary.maxSinglePurchaseValue > 1_000_000) {
    diagnosis.push(
      `🚨 단일 attribution value 최대 ${summary.maxSinglePurchaseValue.toLocaleString("ko-KR")}원 — Cafe24 시계 단가 30만원대 대비 비현실적. 픽셀 가격 단위 오류 가능성.`,
    );
  }
  if (summary.revenueSimpleSum > summary.revenueMaxPerDay * 1.5) {
    diagnosis.push(
      `⚠️ 단순합(${summary.revenueSimpleSum.toLocaleString("ko-KR")}) 이 max-per-day(${summary.revenueMaxPerDay.toLocaleString("ko-KR")}) 보다 1.5배 이상 — 같은 주문이 여러 action_type 으로 중복 fire되고 있을 가능성.`,
    );
  }
  if (c24Total > 0 && summary.revenueMaxPerDay > c24Total * 3) {
    diagnosis.push(
      `🚨 Meta 매출(${summary.revenueMaxPerDay.toLocaleString("ko-KR")}) 이 같은 기간 Cafe24 전체 주문 합(${c24Total.toLocaleString("ko-KR")}) 의 3배 초과 — 픽셀 부풀림 거의 확정.`,
    );
  }
  if (diagnosis.length === 0) {
    diagnosis.push("✅ 자동 진단 의심 신호 없음 (육안 확인 필요).");
  }

  return Response.json({ ok: true, adsetId, days, meta, cafe24, diagnosis });
}
