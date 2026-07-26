/**
 * 일일 매출 스냅샷 — 모든 채널의 dailyRevenue 를 brand 별로 모아
 * `revenue_history:{brand}` KV 에 적재한다.
 *
 * cron(매일 KST 새벽) + 수동 백필(엔드포인트) 양쪽에서 사용.
 *
 * 정책:
 *   - 카페24(paulvice 만, 실 API): 토큰이 있으면 호출, 없으면 skip.
 *   - channel_upload:* 의 dailyRevenue: 각 채널별 브랜드 매핑 따라 적재.
 *   - 기존 (date, channel) 값은 새 값으로 덮어쓴다 (upload 재업로드 / kakao PO sync 결과 갱신 반영).
 */
import { createClient } from "@supabase/supabase-js";
import { getDashboardData, getMallShopData, type DailyData } from "@/lib/cafe24Data";
import { USD_TO_KRW } from "@/lib/finance/forex";
import { upsertRevenueDays } from "@/lib/finance/revenueHistory";
import { BRAND_CHANNELS, type Brand, type ChannelId } from "@/lib/multiChannelData";
import { loadCafe24Historical, mergeCafe24HistoricalDaily } from "@/lib/cafe24Historical";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 채널 ID → 어느 브랜드에 속하는지 (없으면 null) */
function channelBrand(channel: string): Brand | null {
  for (const [brand, channels] of Object.entries(BRAND_CHANNELS) as Array<[Brand, ChannelId[]]>) {
    if (channels.includes(channel as ChannelId)) return brand;
  }
  return null;
}

interface SnapshotResult {
  paulvice: { days: number; channels: string[] };
  harriot:  { days: number; channels: string[] };
}

/**
 * 모든 채널 dailyRevenue → brand 별 entries 로 변환 후 upsert.
 * @param cafe24Token   폴바이스 cafe24 access token (없으면 폴바이스 cafe24 라이브 skip)
 * @param harriotToken  해리엇 cafe24 access token (없으면 해리엇 cafe24 라이브 skip) — 국내몰 식스샵→카페24 이전
 */
export async function runRevenueSnapshot(
  cafe24Token: string | null,
  harriotToken: string | null = null,
): Promise<SnapshotResult> {
  // brand → channel → date → revenue
  const buf: Record<Brand, Map<string, Map<string, number>>> = {
    paulvice: new Map(),
    harriot:  new Map(),
  };

  const addEntry = (brand: Brand, channel: string, date: string, revenue: number) => {
    let chMap = buf[brand].get(channel);
    if (!chMap) { chMap = new Map(); buf[brand].set(channel, chMap); }
    // 같은 (channel, date) 가 또 들어오면 마지막 값으로 덮어쓰기
    chMap.set(date, revenue);
  };

  // ── 1a. 카페24 히스토리 보조 CSV (cafe24_historical:{brand}) ──────
  // 라이브 API 가 못 가져오는 과거 기간(예: 1~3개월 전)은 사용자가 CSV 업로드.
  // 토큰 없어도 로드 가능하므로 라이브보다 먼저 적재 → 라이브가 같은 날짜를
  // 덮어쓸 수 있게 한다 (라이브 우선 정책).
  for (const brand of ["paulvice", "harriot"] as const) {
    try {
      const record = await loadCafe24Historical(brand);
      if (record.uploads.length === 0) continue;
      const merged = mergeCafe24HistoricalDaily(record);
      const cafe24Channel = brand === "harriot" ? "cafe24_harriot" : "cafe24";
      for (const d of merged) {
        if (!d.date || !Number.isFinite(d.revenue)) continue;
        addEntry(brand, cafe24Channel, d.date, Math.round(d.revenue));
      }
    } catch (e) {
      console.error(
        `[revenueSnapshot] cafe24 historical (${brand}) 로드 실패:`,
        (e as Error).message,
      );
    }
  }

  // ── 1b. 카페24 라이브 API (토큰 필요) ──────────────────────────────
  if (cafe24Token) {
    try {
      const data = await getDashboardData(cafe24Token);
      for (const d of data.dailyRevenue ?? [] as DailyData[]) {
        if (!d.date || !Number.isFinite(d.revenue)) continue;
        addEntry("paulvice", "cafe24", d.date, Math.round(d.revenue));
      }
    } catch (e) {
      console.error("[revenueSnapshot] cafe24 fetch 실패(paulvice):", (e as Error).message);
    }
    // 폴바이스 카페24 영문몰(shop_no=2, paulvice.kr) — USD→KRW 환산.
    try {
      const gdata = await getMallShopData(cafe24Token, "paulvice", 2, { usdToKrw: USD_TO_KRW });
      for (const d of gdata.dailyRevenue ?? [] as DailyData[]) {
        if (!d.date || !Number.isFinite(d.revenue)) continue;
        addEntry("paulvice", "cafe24_global", d.date, Math.round(d.revenue));
      }
    } catch (e) {
      console.error("[revenueSnapshot] cafe24 글로벌 fetch 실패(paulvice shop2):", (e as Error).message);
    }
  }
  // 해리엇 카페24 라이브 (국내몰 식스샵→카페24 이전) — harriot 브랜드 cafe24_harriot 채널로.
  if (harriotToken) {
    try {
      const data = await getDashboardData(harriotToken, "harriot");
      for (const d of data.dailyRevenue ?? [] as DailyData[]) {
        if (!d.date || !Number.isFinite(d.revenue)) continue;
        addEntry("harriot", "cafe24_harriot", d.date, Math.round(d.revenue));
      }
    } catch (e) {
      console.error("[revenueSnapshot] cafe24 fetch 실패(harriot):", (e as Error).message);
    }
    // 해리엇 카페24 글로벌 영문몰(shop_no=2) — 식스샵 글로벌 대체. USD→KRW 환산.
    try {
      const gdata = await getMallShopData(harriotToken, "harriot", 2, { usdToKrw: USD_TO_KRW });
      for (const d of gdata.dailyRevenue ?? [] as DailyData[]) {
        if (!d.date || !Number.isFinite(d.revenue)) continue;
        addEntry("harriot", "cafe24_harriot_global", d.date, Math.round(d.revenue));
      }
    } catch (e) {
      console.error("[revenueSnapshot] cafe24 글로벌 fetch 실패(harriot shop2):", (e as Error).message);
    }
  }

  // ── 2. channel_upload:* (엑셀 업로드 + kakao_gift 머지 결과) ──────
  const db = getDb();
  if (db) {
    const { data: rows } = await db
      .from("kv_store")
      .select("key, data")
      .like("key", "channel_upload:%");

    for (const row of (rows ?? []) as Array<{
      key: string;
      data: unknown;
    }>) {
      const channel = row.key.slice("channel_upload:".length);
      const brand = channelBrand(channel);
      if (!brand) continue;
      // 신 포맷: { uploads: [{ data: { dailyRevenue }, ... }] }  — 날짜별 최신값으로 머지
      // 구 포맷: { data: { dailyRevenue }, meta }              — 그대로
      const r = row.data as Record<string, unknown> | null;
      const merged = new Map<string, number>();
      if (r && Array.isArray((r as { uploads?: unknown }).uploads)) {
        const uploads = (r as { uploads: Array<{ uploadedAt?: string; data?: { dailyRevenue?: DailyData[] } }> }).uploads;
        const sorted = [...uploads].sort((a, b) =>
          (a.uploadedAt ?? "").localeCompare(b.uploadedAt ?? "")
        );
        for (const up of sorted) {
          for (const d of up.data?.dailyRevenue ?? []) {
            if (!d?.date || !Number.isFinite(d.revenue)) continue;
            merged.set(d.date, Math.round(d.revenue));
          }
        }
      } else {
        const daily =
          (r as { data?: { dailyRevenue?: DailyData[] } } | null)?.data?.dailyRevenue ?? [];
        for (const d of daily) {
          if (!d?.date || !Number.isFinite(d.revenue)) continue;
          merged.set(d.date, Math.round(d.revenue));
        }
      }
      for (const [date, rev] of merged) addEntry(brand, channel, date, rev);
    }
  }

  // ── 3. brand 별로 entries 빌드 후 upsert ─────────────────────────
  const result: SnapshotResult = {
    paulvice: { days: 0, channels: [] },
    harriot:  { days: 0, channels: [] },
  };

  for (const brand of Object.keys(buf) as Brand[]) {
    const channelMaps = buf[brand];
    if (channelMaps.size === 0) continue;

    // date → byChannel 로 뒤집기
    const dateToChannel = new Map<string, Record<string, number>>();
    for (const [channel, dateMap] of channelMaps) {
      for (const [date, rev] of dateMap) {
        const ex = dateToChannel.get(date) ?? {};
        ex[channel] = rev;
        dateToChannel.set(date, ex);
      }
    }

    const entries = Array.from(dateToChannel.entries()).map(([date, byChannel]) => ({
      date,
      byChannel,
    }));
    await upsertRevenueDays(brand, entries);

    result[brand] = {
      days:     entries.length,
      channels: Array.from(channelMaps.keys()).sort(),
    };
  }

  return result;
}
