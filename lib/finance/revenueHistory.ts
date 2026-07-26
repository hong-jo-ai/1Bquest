/**
 * 브랜드별 일별 매출 히스토리 — 대시보드 매출 추이 그래프용.
 *
 * 데이터 소스:
 *   - 카페24 (paulvice/해리엇 실 API) — `cafe24Data.dailyRevenue`
 *     · 해리엇 국내몰=cafe24_harriot(shop_no=1), 글로벌 영문몰=cafe24_harriot_global(shop_no=2, USD→KRW)
 *   - 엑셀 업로드 채널 — `channel_upload:<channel>` 의 `data.dailyRevenue`
 *     (해리엇 naver_smartstore 등)
 *   - 카카오선물하기 — `channel_upload:kakao_gift` 머지 결과
 *
 * 스토리지: Supabase `kv_store`
 *   key   = `revenue_history:{brand}`
 *   value = { days: { "YYYY-MM-DD": { total, byChannel } } }
 *
 * 1년치 = 365 × ~50 bytes = 약 18KB → KV 한 행에 무리 없이 들어감.
 */
import { createClient } from "@supabase/supabase-js";
import type { Brand } from "@/lib/multiChannelData";

const KEY_PREFIX = "revenue_history:";

export interface RevenueHistoryDay {
  total:     number;
  byChannel: Record<string, number>;
}

export interface RevenueHistory {
  /** "YYYY-MM-DD" → { total, byChannel } */
  days: Record<string, RevenueHistoryDay>;
}

const EMPTY: RevenueHistory = { days: {} };

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function historyKey(brand: Brand): string {
  return `${KEY_PREFIX}${brand}`;
}

export async function loadRevenueHistory(brand: Brand): Promise<RevenueHistory> {
  const db = getDb();
  if (!db) return EMPTY;
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", historyKey(brand))
    .maybeSingle();
  const raw = data?.data as RevenueHistory | undefined;
  if (!raw || typeof raw !== "object" || !raw.days) return EMPTY;
  return raw;
}

export async function saveRevenueHistory(
  brand: Brand,
  history: RevenueHistory,
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const { error } = await db.from("kv_store").upsert(
    {
      key:        historyKey(brand),
      data:       history,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}

/**
 * 여러 날짜 entry 를 머지해서 저장. 같은 (date, channel) 은 덮어쓰기 (최신 데이터 우선).
 */
export async function upsertRevenueDays(
  brand: Brand,
  entries: Array<{ date: string; byChannel: Record<string, number> }>,
): Promise<{ updated: number }> {
  if (entries.length === 0) return { updated: 0 };
  const current = await loadRevenueHistory(brand);
  const next: RevenueHistory = { days: { ...current.days } };
  for (const { date, byChannel } of entries) {
    const prev = next.days[date]?.byChannel ?? {};
    const merged: Record<string, number> = { ...prev, ...byChannel };
    let total = 0;
    for (const v of Object.values(merged)) total += v;
    next.days[date] = { total, byChannel: merged };
  }
  await saveRevenueHistory(brand, next);
  return { updated: entries.length };
}
