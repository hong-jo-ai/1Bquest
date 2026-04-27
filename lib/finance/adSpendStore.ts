/**
 * 외부 광고 플랫폼 일별 광고비 저장소.
 * Supabase kv_store에 채널별로 `ad_spend:<source>` 키로 보관.
 *
 * 값 형식:
 *   { "YYYY-MM-DD": <spend_krw>, ... }
 *
 * 메타는 API에서 매번 조회하므로 여기에 저장하지 않음.
 * CSV 업로드 방식 채널(W컨셉, 추후 구글/네이버/카카오 등)만 사용.
 */
import { createClient } from "@supabase/supabase-js";

export type AdSource = "wconcept" | "google" | "naver" | "kakao";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function kvKey(source: AdSource): string {
  return `ad_spend:${source}`;
}

export type DailySpendMap = Record<string, number>;

export async function loadAdSpend(source: AdSource): Promise<DailySpendMap> {
  const db = getDb();
  if (!db) return {};
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", kvKey(source))
    .maybeSingle();
  return (data?.data as DailySpendMap | null) ?? {};
}

/**
 * 새 일별 데이터를 기존 맵에 머지(upsert) 후 저장.
 * 같은 날짜는 새 값으로 덮어씀 (재업로드 시 최신 데이터 우선).
 */
export async function mergeAdSpend(
  source: AdSource,
  daily: Array<{ date: string; spend: number }>
): Promise<{ inserted: number; updated: number; total: number }> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");

  const existing = await loadAdSpend(source);
  let inserted = 0;
  let updated = 0;
  const next: DailySpendMap = { ...existing };
  for (const { date, spend } of daily) {
    if (date in next) updated++;
    else inserted++;
    next[date] = spend;
  }

  const { error } = await db.from("kv_store").upsert(
    { key: kvKey(source), data: next, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);

  return { inserted, updated, total: Object.keys(next).length };
}

/** 기간 필터링된 일별 배열 반환 (P&L 계산용) */
export async function getAdSpendDaily(
  source: AdSource,
  since: string,
  until: string
): Promise<Array<{ date: string; spend: number }>> {
  const map = await loadAdSpend(source);
  return Object.entries(map)
    .filter(([d]) => d >= since && d <= until)
    .map(([date, spend]) => ({ date, spend }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
