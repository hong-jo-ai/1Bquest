/**
 * 카카오선물하기 SKU 매핑 — 카카오 정산서의 내부 sku 를 Cafe24 product_code 로 매핑.
 * 재고 sync 가 카카오 채널 판매를 본 SKU 재고에서 차감하기 위해 필요.
 *
 * KV key: kakao_gift_sku_map
 * 값: { mappings: KakaoSkuMapEntry[] }
 */
import { createClient } from "@supabase/supabase-js";

const KV_KEY = "kakao_gift_sku_map";

export interface KakaoSkuMapEntry {
  /** 카카오 정산서의 sku (내부 상품번호) */
  kakaoSku:    string;
  /** 참고용 카카오 상품명 — UI 식별용, 매칭에 사용 X */
  kakaoName?:  string;
  /** 매칭할 Cafe24 product_code (예: P00000HO) */
  cafe24Code:  string;
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function loadKakaoGiftSkuMap(): Promise<KakaoSkuMapEntry[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", KV_KEY)
    .maybeSingle();
  const stored = data?.data as { mappings?: KakaoSkuMapEntry[] } | null;
  return stored?.mappings ?? [];
}

export async function saveKakaoGiftSkuMap(mappings: KakaoSkuMapEntry[]): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  // dedupe by kakaoSku
  const seen = new Set<string>();
  const cleaned = mappings
    .filter((m) => m.kakaoSku.trim() && m.cafe24Code.trim())
    .map((m) => ({
      kakaoSku:   m.kakaoSku.trim(),
      kakaoName:  m.kakaoName?.trim() || undefined,
      cafe24Code: m.cafe24Code.trim(),
    }))
    .filter((m) => {
      if (seen.has(m.kakaoSku)) return false;
      seen.add(m.kakaoSku);
      return true;
    });
  await db.from("kv_store").upsert(
    { key: KV_KEY, data: { mappings: cleaned }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

/** 빠른 lookup 용 — kakaoSku → cafe24Code Map */
export async function buildKakaoToCafe24Map(): Promise<Map<string, string>> {
  const list = await loadKakaoGiftSkuMap();
  const map = new Map<string, string>();
  for (const m of list) map.set(m.kakaoSku, m.cafe24Code);
  return map;
}
