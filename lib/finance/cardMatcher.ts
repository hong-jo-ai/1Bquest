/**
 * 통장 거래내역의 카드 결제 통합 출금건을 카드 사용내역과 매칭.
 *
 * 통장에 "비자해외승인대금출금", "현대카드대금출금" 같은 통합 출금이 있으면
 * 어떤 가맹점에서 어디에 썼는지 모름. 같은 시기/금액의 카드 사용내역(상세)과
 * 매칭해서 거래 디테일을 풍부화한다.
 *
 * 매칭 윈도우: 출금일 직전 -45 ~ -1일 (보통 카드 결제 주기)
 * 매칭 기준: 카드사 source 추정 + 같은 source의 그 윈도우 사용내역 합계가
 *           ±10% 이내 또는 가까운 후보들.
 */
import { createClient } from "@supabase/supabase-js";

export type CardSource = "card_hyundai" | "card_kb" | "npay";

export interface CardUsageItem {
  approval_no: string | null;
  use_date: string;
  merchant: string | null;
  amount: number;
  cancel_amount: number;
  category: string | null;
  source: string;
  card_company: string | null;
}

export interface CardMatch {
  cardSource: CardSource | "unknown";
  isForeign: boolean;
  windowSince: string;
  windowUntil: string;
  matchedTotal: number;
  /** 출금액 대비 매칭 합계 정확도. 0~1 (1=완벽 일치) */
  matchScore: number;
  items: CardUsageItem[];
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * 통장 description / counterparty 텍스트에서 카드사 + 해외 여부 감지.
 * 패턴은 categorize.ts의 카드결제 룰과 일치.
 */
export function detectCardPattern(text: string): {
  source: CardSource | "unknown";
  isForeign: boolean;
  isCardPayment: boolean;
} {
  const t = text || "";
  const isForeign =
    /비자\s*해외|VISA\s*해외|마스터\s*해외|MASTER\s*해외|해외승인|해외이용|해외사용/i.test(t);

  let source: CardSource | "unknown" = "unknown";
  if (/현대카드/.test(t)) source = "card_hyundai";
  else if (/KB카드|국민카드|KB국민카드|KB체크|국민체크/.test(t)) source = "card_kb";
  else if (/네이버페이|N\s*Pay/i.test(t)) source = "npay";

  const isCardPayment =
    isForeign ||
    source !== "unknown" ||
    /카드대금|카드결제|카드출금|JCB/.test(t);

  return { source, isForeign, isCardPayment };
}

// 매칭 임계값
const MIN_MATCH_SCORE = 0.7;     // 출금 대비 ±30% 이내만 신뢰 (합계 매칭)
const MAX_ITEMS = 50;            // 그 이상 묶이면 통합 출금이 아닐 가능성 큼
const EXACT_AMOUNT_TOLERANCE = 1; // 단일 건 정확 매칭 허용 오차 (원)

function withdrawalDateRange(txDate: string): { since: Date; until: Date } {
  const until = new Date(txDate);
  until.setDate(until.getDate() - 1);
  const since = new Date(txDate);
  since.setDate(since.getDate() - 45);
  return { since, until };
}

/**
 * 단일 건 정확 매칭: 같은 금액(±1원)의 카드 사용건이 윈도우 내 1건이면 매칭.
 * 카드사 식별 못해도 동작. 페이스북 광고비 같은 단일 결제 출금에 효과적.
 */
async function findSingleExactMatch(
  supabase: ReturnType<typeof getDb>,
  businessId: string,
  withdrawal: number,
  since: Date,
  until: Date,
  isForeignContext: boolean,
): Promise<CardUsageItem[] | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("finance_card_usage")
    .select("approval_no, use_date, merchant, amount, cancel_amount, category, source, card_company")
    .eq("business_id", businessId)
    .gte("use_date", since.toISOString())
    .lte("use_date", until.toISOString())
    .gte("amount", withdrawal - EXACT_AMOUNT_TOLERANCE)
    .lte("amount", withdrawal + EXACT_AMOUNT_TOLERANCE)
    .eq("cancel_amount", 0)
    .order("use_date", { ascending: false });

  if (error || !data || data.length === 0) return null;

  // 해외 출금 컨텍스트면 해외성 단서 가진 항목 우선 (네이버페이 하나(외환))
  let candidates = data as CardUsageItem[];
  if (isForeignContext) {
    const foreignFiltered = candidates.filter((r) =>
      (r.card_company ?? "").includes("외환") ||
      (r.card_company ?? "").includes("VISA") ||
      (r.card_company ?? "").includes("MASTER"),
    );
    if (foreignFiltered.length === 1) return foreignFiltered;
    if (foreignFiltered.length > 1) candidates = foreignFiltered;
  }

  // 정확히 1건일 때만 매칭 (모호 회피)
  return candidates.length === 1 ? candidates : null;
}

/**
 * 한 통장 거래에 매칭되는 카드 사용내역 묶음 조회.
 *
 * 매칭 시도 순서:
 *   1. 카드사 식별 → 그 카드의 윈도우 내 합계 매칭 (정확도 70%+)
 *   2. 카드사 미식별 또는 합계 매칭 실패 → 단일 건 정확 금액 매칭
 *
 * @param businessId  현재 사업자
 * @param txDate      통장 출금일
 * @param withdrawal  출금액 (원)
 * @param description description + counterparty + memo 합친 매칭용 텍스트
 */
export async function matchCardUsages(
  businessId: string,
  txDate: string,
  withdrawal: number,
  description: string,
): Promise<CardMatch | null> {
  const supabase = getDb();
  if (!supabase) return null;
  if (!withdrawal || withdrawal <= 0) return null;

  const detect = detectCardPattern(description);
  if (!detect.isCardPayment) return null;

  const { since, until } = withdrawalDateRange(txDate);
  const windowSince = since.toISOString().slice(0, 10);
  const windowUntil = until.toISOString().slice(0, 10);

  // ── 1단계: 카드사 식별된 경우 합계 매칭 ────────────────────────────
  if (detect.source !== "unknown") {
    const { data, error } = await supabase
      .from("finance_card_usage")
      .select("approval_no, use_date, merchant, amount, cancel_amount, category, source, card_company")
      .eq("business_id", businessId)
      .eq("source", detect.source)
      .gte("use_date", since.toISOString())
      .lte("use_date", until.toISOString())
      .order("use_date", { ascending: true });

    if (!error && data && data.length > 0 && data.length <= MAX_ITEMS) {
      const items = (data as CardUsageItem[]).filter(
        (r) => (Number(r.amount) || 0) - (Number(r.cancel_amount) || 0) > 0,
      );
      if (items.length > 0) {
        const matchedTotal = items.reduce(
          (s, r) => s + ((Number(r.amount) || 0) - (Number(r.cancel_amount) || 0)),
          0,
        );
        const ratio = matchedTotal / withdrawal;
        const matchScore = ratio >= 1 ? 1 / ratio : ratio;
        if (matchScore >= MIN_MATCH_SCORE) {
          return {
            cardSource: detect.source,
            isForeign: detect.isForeign,
            windowSince,
            windowUntil,
            matchedTotal,
            matchScore,
            items,
          };
        }
      }
    }
  }

  // ── 2단계: 단일 건 정확 금액 매칭 (카드사 무관) ─────────────────────
  const single = await findSingleExactMatch(
    supabase,
    businessId,
    withdrawal,
    since,
    until,
    detect.isForeign,
  );
  if (single && single.length === 1) {
    const item = single[0];
    const matchedTotal = (Number(item.amount) || 0) - (Number(item.cancel_amount) || 0);
    return {
      cardSource: (item.source as CardSource) ?? "unknown",
      isForeign: detect.isForeign,
      windowSince,
      windowUntil,
      matchedTotal,
      matchScore: 1,
      items: single,
    };
  }

  return null;
}

/**
 * 여러 통장 거래에 대해 매칭 일괄 처리.
 * (서버에서 Promise.all로 병렬 매칭)
 */
export async function enrichBankTxsWithCardMatches(
  businessId: string,
  txs: Array<{ id: string; tx_date: string; withdrawal: number; description: string | null; counterparty: string | null; memo: string | null }>,
): Promise<Record<string, CardMatch>> {
  const out: Record<string, CardMatch> = {};
  const candidates = txs.filter((t) => {
    if (!t.withdrawal || Number(t.withdrawal) <= 0) return false;
    const text = `${t.counterparty ?? ""} ${t.description ?? ""} ${t.memo ?? ""}`;
    return detectCardPattern(text).isCardPayment;
  });

  await Promise.all(
    candidates.map(async (t) => {
      const text = `${t.counterparty ?? ""} ${t.description ?? ""} ${t.memo ?? ""}`;
      const m = await matchCardUsages(businessId, t.tx_date, Number(t.withdrawal), text);
      if (m && m.items.length > 0) out[t.id] = m;
    }),
  );

  return out;
}
