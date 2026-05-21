import { createClient } from "@supabase/supabase-js";
import { cafe24Get } from "../cafe24Client";
import type { Cafe24Product } from "../cafe24Client";
import { getValidC24Token } from "../cafe24Auth";
import { getProductCogs } from "../profitSettings";
import { loadKakaoGiftSkuMap } from "../finance/kakaoGiftSkuMap";
import { rankCandidates, AUTO_MATCH_THRESHOLD, type SkuRef } from "./match";
import { KAKAO_FEE_RATE } from "./parsers";
import type {
  PricingChannel,
  NormalizedChannelProduct,
  ChannelSkuMap,
  CatalogEntry,
  ChannelPriceCell,
  UnmatchedChannelProduct,
} from "./types";

const EXCEL_CHANNELS: PricingChannel[] = ["wconcept", "musinsa", "29cm"];

const rawKey = (ch: PricingChannel) => `channel_pricing:raw:${ch}`;
const skuMapKey = (ch: PricingChannel) => `channel_pricing:skumap:${ch}`;

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function readKv<T>(key: string, fallback: T): Promise<T> {
  const db = getDb();
  if (!db) return fallback;
  const { data } = await db.from("kv_store").select("data").eq("key", key).maybeSingle();
  return (data?.data as T) ?? fallback;
}

async function writeKv(key: string, value: unknown): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const { error } = await db
    .from("kv_store")
    .upsert({ key, data: value as object, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// ── 채널 raw 업로드 / SKU 매핑 저장 ──────────────────────────────────────

export async function saveChannelRaw(ch: PricingChannel, products: NormalizedChannelProduct[]): Promise<void> {
  await writeKv(rawKey(ch), { products, uploadedAt: new Date().toISOString() });
}
export async function loadChannelRaw(ch: PricingChannel): Promise<NormalizedChannelProduct[]> {
  const v = await readKv<{ products?: NormalizedChannelProduct[] }>(rawKey(ch), {});
  return v.products ?? [];
}
export async function loadChannelSkuMap(ch: PricingChannel): Promise<ChannelSkuMap> {
  return readKv<ChannelSkuMap>(skuMapKey(ch), {});
}
export async function saveChannelSkuMap(ch: PricingChannel, map: ChannelSkuMap): Promise<void> {
  await writeKv(skuMapKey(ch), map);
}
/** channelCode → sku 한 건 추가(수동 확인). */
export async function linkChannelCode(ch: PricingChannel, channelCode: string, sku: string): Promise<void> {
  const map = await loadChannelSkuMap(ch);
  map[channelCode] = sku;
  await saveChannelSkuMap(ch, map);
}

/** 여러 건 일괄 연결 — 채널별로 맵을 한 번씩만 읽고 써서 효율적. */
export async function linkChannelCodesBulk(
  links: Array<{ channel: PricingChannel; channelCode: string; sku: string }>,
): Promise<number> {
  const byChannel = new Map<PricingChannel, Array<{ channelCode: string; sku: string }>>();
  for (const l of links) {
    if (!l.channelCode || !l.sku) continue;
    if (!byChannel.has(l.channel)) byChannel.set(l.channel, []);
    byChannel.get(l.channel)!.push({ channelCode: l.channelCode, sku: l.sku });
  }
  let count = 0;
  for (const [ch, items] of byChannel) {
    const map = await loadChannelSkuMap(ch);
    for (const it of items) {
      map[it.channelCode] = it.sku;
      count++;
    }
    await saveChannelSkuMap(ch, map);
  }
  return count;
}

// ── Cafe24 마스터 카탈로그 (canonical) ───────────────────────────────────

async function fetchCafe24Products(token: string): Promise<Cafe24Product[]> {
  const all: Cafe24Product[] = [];
  let offset = 0;
  const limit = 100;
  while (offset < 3000) {
    const data = (await cafe24Get(
      `/api/v2/admin/products?limit=${limit}&offset=${offset}&display=T`,
      token,
    )) as { products?: Cafe24Product[] };
    const batch = data.products ?? [];
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export interface AssembledCatalog {
  entries: CatalogEntry[];
  unmatched: UnmatchedChannelProduct[];
  cogs: Record<string, number>;
  channelStatus: Record<PricingChannel, { hasData: boolean; count: number }>;
  /** 전체 canonical SKU 목록 — 미매칭 수동연결 드롭다운용 */
  skus: SkuRef[];
}

/**
 * 전 채널 가격을 canonical SKU 기준으로 조립.
 *
 * - cafe24: 상품 API 실시간 (정가=retail_price, 할인가=price, net=price ≈ 자사몰 PG 제외 전)
 * - wconcept/musinsa/29cm: 업로드된 raw + skumap(없으면 이름 자동매칭). 미매칭은 unmatched 로.
 * - kakao_gift: raw(매출 역산) + 기존 kakao_gift_sku_map(카카오코드→cafe24Code) 재사용.
 */
export async function assembleCatalog(): Promise<AssembledCatalog> {
  const token = await getValidC24Token();
  const cafe24Products = token ? await fetchCafe24Products(token) : [];

  const entries: Record<string, CatalogEntry> = {};
  const skuRefs: SkuRef[] = [];
  for (const p of cafe24Products) {
    const sku = (p.product_code ?? "").trim();
    if (!sku) continue;
    const list = num(p.retail_price) ?? num(p.price);
    const discount = num(p.price);
    entries[sku] = {
      sku,
      name: p.product_name ?? sku,
      image: p.list_image ?? p.tiny_image ?? p.detail_image ?? null,
      channels: {
        cafe24: {
          list,
          discount,
          net: discount, // 자사몰: 수수료 거의 0 (PG 수수료는 추후 반영)
          source: "api",
          updatedAt: new Date().toISOString(),
        },
      },
    };
    skuRefs.push({ sku, name: p.product_name ?? sku });
  }

  const unmatched: UnmatchedChannelProduct[] = [];
  const channelStatus = {} as AssembledCatalog["channelStatus"];

  // 엑셀 채널 (이름/skumap 매칭)
  for (const ch of EXCEL_CHANNELS) {
    const raw = await loadChannelRaw(ch);
    const map = await loadChannelSkuMap(ch);
    channelStatus[ch] = { hasData: raw.length > 0, count: raw.length };
    for (const p of raw) {
      let sku = map[p.channelCode];
      if (!sku) {
        const cands = rankCandidates(p.name, skuRefs);
        if (cands[0] && cands[0].score >= AUTO_MATCH_THRESHOLD) sku = cands[0].sku;
        else {
          unmatched.push({ channel: ch, channelCode: p.channelCode, name: p.name, image: p.image ?? null, list: p.list, discount: p.discount, net: p.net, candidates: cands });
          continue;
        }
      }
      attachCell(entries, sku, ch, p);
    }
  }

  // 카카오: 매출 역산 raw + 기존 kakao_gift_sku_map
  {
    const ch: PricingChannel = "kakao_gift";
    const raw = await loadChannelRaw(ch);
    channelStatus[ch] = { hasData: raw.length > 0, count: raw.length };
    const kmap = await loadKakaoGiftSkuMap();
    const byKakaoSku = new Map<string, string>();
    for (const m of kmap) if (!m.optionText) byKakaoSku.set(m.kakaoSku, m.cafe24Code);
    // 수동연결(channel_pricing:skumap:kakao_gift) 우선, 없으면 기존 kakao_gift_sku_map
    const manualMap = await loadChannelSkuMap(ch);
    for (const p of raw) {
      const sku = manualMap[p.channelCode] ?? byKakaoSku.get(p.channelCode);
      if (!sku || !entries[sku]) {
        if (p.discount != null) {
          unmatched.push({ channel: ch, channelCode: p.channelCode, name: p.name, image: null, list: p.list, discount: p.discount, net: p.net, candidates: rankCandidates(p.name, skuRefs) });
        }
        continue;
      }
      attachCell(entries, sku, ch, p);
    }
  }

  const cogs = await getProductCogs();

  return {
    entries: Object.values(entries).sort((a, b) => a.name.localeCompare(b.name, "ko")),
    unmatched,
    cogs,
    channelStatus,
    skus: skuRefs.sort((a, b) => a.name.localeCompare(b.name, "ko")),
  };
}

function attachCell(
  entries: Record<string, CatalogEntry>,
  sku: string,
  ch: PricingChannel,
  p: NormalizedChannelProduct,
): void {
  const e = entries[sku];
  if (!e) return; // 채널엔 있는데 cafe24 마스터에 없는 SKU — v1은 무시(미매칭으로 안 잡음)
  const cell: ChannelPriceCell = {
    list: p.list,
    discount: p.discount,
    net: p.net,
    source: ch === "kakao_gift" ? "skumap" : "excel",
    channelCode: p.channelCode,
    status: p.status ?? null,
    updatedAt: new Date().toISOString(),
  };
  e.channels[ch] = cell;
  if (!e.image && p.image) e.image = p.image;
}

export { KAKAO_FEE_RATE };
