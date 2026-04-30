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
import { getDashboardData, type DailyData } from "@/lib/cafe24Data";
import { upsertRevenueDays } from "@/lib/finance/revenueHistory";
import { BRAND_CHANNELS, type Brand, type ChannelId } from "@/lib/multiChannelData";

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
 * @param cafe24Token  cafe24 access token (paulvice 만 해당, 없으면 cafe24 부분 skip)
 */
export async function runRevenueSnapshot(
  cafe24Token: string | null,
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

  // ── 1. 카페24 (paulvice) ────────────────────────────────────────
  if (cafe24Token) {
    try {
      const data = await getDashboardData(cafe24Token);
      for (const d of data.dailyRevenue ?? [] as DailyData[]) {
        if (!d.date || !Number.isFinite(d.revenue)) continue;
        addEntry("paulvice", "cafe24", d.date, Math.round(d.revenue));
      }
    } catch (e) {
      console.error("[revenueSnapshot] cafe24 fetch 실패:", (e as Error).message);
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
      data: { data?: { dailyRevenue?: DailyData[] } };
    }>) {
      const channel = row.key.slice("channel_upload:".length);
      const brand = channelBrand(channel);
      if (!brand) continue;
      const daily = row.data?.data?.dailyRevenue ?? [];
      for (const d of daily) {
        if (!d?.date || !Number.isFinite(d.revenue)) continue;
        addEntry(brand, channel, d.date, Math.round(d.revenue));
      }
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
