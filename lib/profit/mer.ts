/**
 * MER (Marketing Efficiency Ratio) — 브랜드별.
 *
 * 시계처럼 저볼륨·고단가 상품은 메타 세트별 ROAS가 과소평가된다(고객이 메타 보고→네이버/직접 검색→
 * 자사몰에서 구매). 그래서 세트 ROAS 대신 **자사몰(cafe24) 매출 ÷ 브랜드 메타 광고비 = 자사몰 MER**로
 * 메타의 실제 기여를 본다. (외부채널 무신사·W컨셉 등은 자체광고라 분모에서 제외.)
 */
import { metaGet } from "@/lib/metaClient";
import { resolveAdAccountId, inferBrandFromCampaign, type Brand } from "@/lib/metaBrandFilter";
import { getMetaTokenFromStore } from "@/lib/metaTokenStore";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { fetchAllOrders, orderRevenue, isCanceledOrder } from "@/lib/cafe24Data";

function kstDate(offset: number): string {
  return new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
}

export interface BrandMer {
  brand: Brand;
  days: number;
  metaSpend: number;        // 브랜드 메타 광고비
  metaPurchaseValue: number; // 메타가 어트리뷰션한 매출
  metaRoas: number;         // 메타 리포트 ROAS (과소평가되는 값)
  metaPurchaseCount: number;
  selfMallRevenue: number;  // 자사몰(cafe24) 실매출
  selfMallOrders: number;
  mer: number | null;       // 자사몰매출 ÷ 메타광고비
}

interface MetaRow {
  spend?: string; campaign_name?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
}
interface Order { payment_date?: string; canceled?: string | null }

/** 브랜드 자사몰 MER 계산 (기본 7일). metaToken 없으면 저장소에서 가져온다. */
export async function computeBrandMer(brand: Brand, days = 7, metaToken?: string | null): Promise<BrandMer> {
  const since = kstDate(-days), until = kstDate(-1);
  const empty: BrandMer = {
    brand, days, metaSpend: 0, metaPurchaseValue: 0, metaRoas: 0, metaPurchaseCount: 0,
    selfMallRevenue: 0, selfMallOrders: 0, mer: null,
  };

  // ── 메타 광고비/ROAS (브랜드 캠페인만) ──
  const token = metaToken ?? (await getMetaTokenFromStore());
  if (token) {
    try {
      const accountId = await resolveAdAccountId(token);
      const ins = (await metaGet(`/${accountId}/insights`, token, {
        level: "campaign",
        time_range: JSON.stringify({ since, until }),
        fields: "spend,campaign_name,actions,action_values",
        limit: "500",
      })) as { data?: MetaRow[] };
      for (const row of ins.data ?? []) {
        if (inferBrandFromCampaign(row.campaign_name) !== brand) continue;
        empty.metaSpend += parseFloat(row.spend ?? "0");
        const pv = (row.action_values ?? []).find((a) => a.action_type === "purchase" || a.action_type === "omni_purchase");
        const pc = (row.actions ?? []).find((a) => a.action_type === "purchase" || a.action_type === "omni_purchase");
        if (pv) empty.metaPurchaseValue += parseFloat(pv.value ?? "0");
        if (pc) empty.metaPurchaseCount += parseFloat(pc.value ?? "0");
      }
    } catch { /* 메타 실패해도 자사몰 매출은 계산 */ }
  }
  empty.metaSpend = Math.round(empty.metaSpend);
  empty.metaPurchaseValue = Math.round(empty.metaPurchaseValue);
  empty.metaRoas = empty.metaSpend > 0 ? empty.metaPurchaseValue / empty.metaSpend : 0;

  // ── 자사몰(cafe24) 실매출 (결제확정·미취소) ──
  try {
    const c24 = await getValidC24Token(brand);
    if (c24) {
      const orders = (await fetchAllOrders(c24, since, until, true, brand)) as Order[];
      let rev = 0, cnt = 0;
      for (const o of orders) {
        if (!o.payment_date) continue;
        if (isCanceledOrder(o)) continue;
        const r = orderRevenue(o as Parameters<typeof orderRevenue>[0]);
        if (r > 0) { rev += r; cnt++; }
      }
      empty.selfMallRevenue = Math.round(rev);
      empty.selfMallOrders = cnt;
    }
  } catch { /* 무시 */ }

  empty.mer = empty.metaSpend > 0 ? empty.selfMallRevenue / empty.metaSpend : null;
  return empty;
}

export async function computeAllBrandMer(days = 7, metaToken?: string | null): Promise<BrandMer[]> {
  const token = metaToken ?? (await getMetaTokenFromStore());
  return Promise.all(([ "paulvice", "harriot" ] as Brand[]).map((b) => computeBrandMer(b, days, token)));
}
