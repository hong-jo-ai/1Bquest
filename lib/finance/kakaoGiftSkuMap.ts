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
  /** 카카오 정산서의 sku (내부 상품번호). 시계는 부모 SKU(예: 12063226) */
  kakaoSku:    string;
  /** 옵션명 — 시계처럼 부모 SKU 가 여러 색상/사이즈로 분기되는 경우 사용 (예: '화이트 브라운') */
  optionText?: string;
  /** 참고용 카카오 상품명 — UI 식별용 */
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
  // dedupe by (kakaoSku|optionText)
  const seen = new Set<string>();
  const cleaned = mappings
    .filter((m) => m.kakaoSku.trim() && m.cafe24Code.trim())
    .map((m) => ({
      kakaoSku:   m.kakaoSku.trim(),
      optionText: m.optionText?.trim() || undefined,
      kakaoName:  m.kakaoName?.trim() || undefined,
      cafe24Code: m.cafe24Code.trim(),
    }))
    .filter((m) => {
      const k = `${m.kakaoSku}|${m.optionText ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  await db.from("kv_store").upsert(
    { key: KV_KEY, data: { mappings: cleaned }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

/** 옵션 무관 단일 SKU 매핑 (jewelry 1:1) — kakaoSku → cafe24Code */
export async function buildKakaoToCafe24Map(): Promise<Map<string, string>> {
  const list = await loadKakaoGiftSkuMap();
  const map = new Map<string, string>();
  for (const m of list) {
    if (!m.optionText) map.set(m.kakaoSku, m.cafe24Code);
  }
  return map;
}

/** 옵션 포함 매핑 — (kakaoSku, optionText) → cafe24Code (시계 등 1:N 분기) */
export async function buildKakaoOptionToCafe24Map(): Promise<Map<string, string>> {
  const list = await loadKakaoGiftSkuMap();
  const map = new Map<string, string>();
  for (const m of list) {
    if (m.optionText) map.set(`${m.kakaoSku}|${m.optionText}`, m.cafe24Code);
  }
  return map;
}

/** PO 주문(product 이름 + option 텍스트)으로 cafe24Code 찾기 — 시계 등 옵션 분기용 */
export function findCafe24ByPoOrder(
  optionMap: Map<string, string>,
  kakaoSkuByName: Map<string, string>, // 카카오 상품명 → 카카오 sku (parent)
  productName: string,
  optionText: string,
): string | null {
  // 카카오 상품명 → kakaoSku 찾고, 옵션 텍스트로 분기 매칭
  const sku = kakaoSkuByName.get(productName);
  if (!sku) return null;
  // optionText 정규화 — '선택: ' 같은 prefix 제거
  const cleanedOption = optionText.replace(/^[^:：]+[:：]\s*/, "").trim();
  // 1차: 정확 매칭
  let code = optionMap.get(`${sku}|${cleanedOption}`);
  if (code) return code;
  // 2차: substring 매칭 (어느 쪽이 다른 쪽 포함)
  for (const [key, val] of optionMap) {
    const [keySku, keyOption] = key.split("|");
    if (keySku !== sku) continue;
    if (keyOption.includes(cleanedOption) || cleanedOption.includes(keyOption)) return val;
  }
  return null;
}
