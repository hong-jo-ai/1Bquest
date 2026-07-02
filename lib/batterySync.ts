/**
 * 배터리 자동차감 (Phase 2) — 시계 판매량에 따라 부자재(배터리) 재고를 차감한다.
 *
 * 매핑: kv `battery_sku_map` = { paulvice: {product_code: spec}, harriot: {...} }
 *   (모델→배터리 규격, 액세서리 제외. 여성용=레이디. buildBatterySkuMap 로 생성)
 * 차감 방식: SupplyItem.baselineConsumed(마지막으로 반영한 누적 판매량) 스냅샷 이후의
 *   증가분(delta)만 currentStock 에서 뺀다. 첫 실행은 기준선만 잡고 차감 안 함("이제부터").
 * 판매량 소스: computeInventoryLevels(cafe24 직접 + 전 채널 합산 totalSold) 두 몰.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeInventoryLevels } from "./inventorySync";
import { getAccessTokenFromStore } from "./cafe24TokenStore";
import { DEFAULT_SUPPLIES, SUPPLIES_KEY, type SupplyItem } from "./suppliesStorage";
import type { MallId } from "./cafe24Client";

const MAP_KEY = "battery_sku_map";

function getDb(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

export interface BatterySyncResult {
  ok: boolean;
  error?: string;
  firstRun?: boolean;
  soldBySpec?: Record<string, number>;
  deducted?: Record<string, number>;
  stocks?: Record<string, number>;
}

export async function runBatterySync(): Promise<BatterySyncResult> {
  const supabase = getDb();
  if (!supabase) return { ok: false, error: "Supabase 미설정" };

  // 1) 매핑 로드
  const { data: mapRow } = await supabase
    .from("kv_store").select("data").eq("key", MAP_KEY).maybeSingle();
  const map = (mapRow?.data ?? {}) as Partial<Record<MallId, Record<string, string>>>;
  if (!map.paulvice && !map.harriot) return { ok: false, error: "battery_sku_map 미설정" };

  // 2) 몰별 판매량 → 규격별 누적 합산
  const soldBySpec: Record<string, number> = {};
  for (const mall of ["paulvice", "harriot"] as MallId[]) {
    const codeSpec = map[mall] ?? {};
    if (!Object.keys(codeSpec).length) continue;
    const token = await getAccessTokenFromStore(mall);
    if (!token) continue;
    let levels;
    try { levels = await computeInventoryLevels(token, mall); } catch { continue; }
    for (const lv of levels) {
      const spec = codeSpec[lv.sku];
      if (!spec) continue;
      soldBySpec[spec] = (soldBySpec[spec] ?? 0) + (lv.totalSold ?? 0);
    }
  }

  // 3) supplies 로드 → 배터리 델타 차감
  const { data: supRow } = await supabase
    .from("kv_store").select("data").eq("key", SUPPLIES_KEY).maybeSingle();
  const supplies: SupplyItem[] = Array.isArray(supRow?.data)
    ? (supRow!.data as SupplyItem[])
    : DEFAULT_SUPPLIES.map((s) => ({ ...s }));

  let firstRun = false;
  const deducted: Record<string, number> = {};
  const stocks: Record<string, number> = {};
  for (const item of supplies) {
    if (item.type !== "battery" || item.autoDeduct === false) continue;
    const spec = item.spec ?? item.id.replace(/^battery-/, "");
    const cur = soldBySpec[spec] ?? 0;
    if (item.baselineConsumed === undefined || item.baselineConsumed === null) {
      item.baselineConsumed = cur; // 첫 실행: 기준선만 (차감 X)
      firstRun = true;
    } else {
      const delta = cur - item.baselineConsumed;
      if (delta > 0) {
        item.currentStock = Math.max(0, (item.currentStock ?? 0) - delta);
        deducted[spec] = delta;
      }
      item.baselineConsumed = cur;
    }
    stocks[spec] = item.currentStock ?? 0;
  }

  // 4) 저장
  await supabase.from("kv_store").upsert(
    { key: SUPPLIES_KEY, data: supplies, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  return { ok: true, firstRun, soldBySpec, deducted, stocks };
}
