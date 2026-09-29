/**
 * 업로드 채널(29CM·무신사·W컨셉·카카오·스마트스토어·조선몰·직거래 등)의 매입원가 보강.
 *
 * 왜: 채널 리포트의 sku 는 그 채널 자체 코드라 원가표(카페24 product_code 기준)와 안 맞는다.
 *     그래서 dailyCogs 가 비어 손익 화면에서 이 채널들의 원가가 0 으로 계산됐다
 *     (2026-09 실측: 마켓 매출 2,340만에 원가 0 → 영업이익 약 400만 과대).
 *
 * 방법: 재고 차감용 매핑(lib/inventorySync matchChannelItemToSku — 옵션맵 → 상품명 → 채널코드 사전)으로
 *     상품을 카페24 코드에 붙여 원가를 찾고, 업로드별 **원가율 = Σ(원가×수량) ÷ Σ(매출)** 을 구해
 *     그 업로드의 일별 매출에 곱한다. 채널 리포트엔 일별·상품별 수량이 없어 일별 원가는 추정치다.
 *     매칭 안 된 상품은 같은 원가율로 본다(0 으로 두면 이익이 부풀려진다).
 *     파싱 단계에서 이미 계산된 dailyCogs(>0)가 있는 날짜는 건드리지 않는다.
 */
import { createClient } from "@supabase/supabase-js";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get, type MallId } from "@/lib/cafe24Client";
import { matchChannelItemToSku, loadSkuAlias, normProductName } from "@/lib/inventorySync";
import { getProductCogs, type ProductCogsMap } from "@/lib/profitSettings";
import { BRAND_CHANNELS, type PerUpload, type UploadableChannel } from "@/lib/multiChannelData";

const NAME_MAP_KEY = "profit:cafe24_name_index_v2:";
const NAME_MAP_TTL_MS = 12 * 3600 * 1000;

interface NameIndex {
  /** 정규화 상품명(한글·영문) → product_code */
  map: Record<string, string>;
  /** 상품군 키(상품명 첫 단어, 정규화) → 그 군의 product_code 들. 색상 미상일 때 평균 원가용. */
  families: Record<string, string[]>;
  /** 상품군 키(첫 두 단어). 한 단어 키보다 구체적이라 상품명 어디에 있어도 인정한다. */
  families2: Record<string, string[]>;
}

interface MallCtx {
  nameMap: Map<string, string>;
  families: Record<string, string[]>;
  families2: Record<string, string[]>;
  cogs: ProductCogsMap;
  alias: Record<string, string>;
}

export interface CogsContext {
  malls: Record<MallId, MallCtx>;
  skuMaps: Record<string, Record<string, string>>;
  optMaps: Record<string, Record<string, Record<string, string>>>;
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 카페24 상품 전체를 읽어 이름 사전 + 상품군 사전을 만든다. */
async function buildNameIndex(token: string, mall: MallId): Promise<NameIndex> {
  const map: Record<string, string> = {};
  const fam: Record<string, Set<string>> = {};
  const fam2: Record<string, Set<string>> = {};
  const limit = 100;
  for (let offset = 0, page = 0; page < 40; page++, offset += limit) {
    const data = (await cafe24Get(
      `/api/v2/admin/products?fields=product_code,product_name,eng_product_name&limit=${limit}&offset=${offset}`,
      token,
      mall,
    )) as { products?: Array<{ product_code: string; product_name: string; eng_product_name?: string }> };
    const products = data.products ?? [];
    for (const p of products) {
      if (!p.product_code) continue;
      for (const nm of [p.product_name, p.eng_product_name]) {
        const n = normProductName(nm || "");
        if (n && !map[n]) map[n] = p.product_code;
      }
      // 상품군 키: "기원 비취색" → "기원", "에끌라 오벌 워치 - 골드" → "에끌라", "에끌라오벌"
      const words = String(p.product_name || "").replace(/^\s*(폴바이스|해리엇|paulvice|harriot)\s*/i, "").split(/[\s\-_/·,()[\]]+/).filter(Boolean);
      const k1 = normProductName(words[0] || "");
      if (k1.length >= 2) (fam[k1] ??= new Set()).add(p.product_code);
      if (words.length >= 2) {
        const k2 = normProductName(words.slice(0, 2).join(""));
        if (k2.length >= 3) (fam2[k2] ??= new Set()).add(p.product_code);
      }
    }
    if (products.length < limit) break;
  }
  const families: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(fam)) families[k] = [...v];
  const families2: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(fam2)) families2[k] = [...v];
  return { map, families, families2 };
}

/** 이름 사전 — 매 요청마다 상품 전체를 긁지 않도록 kv 에 12시간 캐시. 갱신 실패 시 옛 캐시를 쓴다. */
async function loadNameIndex(mall: MallId): Promise<NameIndex> {
  const db = getDb();
  const key = `${NAME_MAP_KEY}${mall}`;
  let cached: { at?: number; index?: NameIndex } | null = null;
  if (db) {
    const { data } = await db.from("kv_store").select("data").eq("key", key).maybeSingle();
    cached = (data as { data?: { at?: number; index?: NameIndex } } | null)?.data ?? null;
  }
  if (cached?.index && cached.at && Date.now() - cached.at < NAME_MAP_TTL_MS) return cached.index;
  try {
    const token = await getAccessTokenFromStore(mall);
    if (token) {
      const built = await buildNameIndex(token, mall);
      if (Object.keys(built.map).length > 0) {
        if (db) {
          await db.from("kv_store").upsert(
            { key, data: { at: Date.now(), index: built }, updated_at: new Date().toISOString() },
            { onConflict: "key" },
          );
        }
        return built;
      }
    }
  } catch { /* 카페24 실패 — 아래에서 옛 캐시로 폴백 */ }
  return cached?.index ?? { map: {}, families: {}, families2: {} };
}

export async function loadCogsContext(): Promise<CogsContext> {
  const db = getDb();
  const skuMaps: CogsContext["skuMaps"] = {};
  const optMaps: CogsContext["optMaps"] = {};
  if (db) {
    const { data } = await db.from("kv_store").select("key, data").like("key", "channel_pricing:%");
    for (const r of (data ?? []) as Array<{ key: string; data: unknown }>) {
      if (!r.data || typeof r.data !== "object") continue;
      if (r.key.startsWith("channel_pricing:skumap:")) {
        skuMaps[r.key.replace("channel_pricing:skumap:", "")] = r.data as Record<string, string>;
      } else if (r.key.startsWith("channel_pricing:optmap:")) {
        optMaps[r.key.replace("channel_pricing:optmap:", "")] = r.data as Record<string, Record<string, string>>;
      }
    }
  }
  const mallCtx = async (mall: MallId): Promise<MallCtx> => {
    const [index, cogs, alias] = await Promise.all([
      loadNameIndex(mall).catch(() => ({ map: {}, families: {}, families2: {} } as NameIndex)),
      getProductCogs(mall).catch(() => ({} as ProductCogsMap)),
      loadSkuAlias(mall).catch(() => ({} as Record<string, string>)),
    ]);
    return {
      nameMap: new Map(Object.entries(index.map)),
      families: index.families ?? {},
      families2: index.families2 ?? {},
      cogs,
      alias,
    };
  };
  const [paulvice, harriot] = await Promise.all([mallCtx("paulvice"), mallCtx("harriot")]);
  return { malls: { paulvice, harriot } as Record<MallId, MallCtx>, skuMaps, optMaps };
}

/** 채널이 속한 몰 — 브랜드 채널 목록이 단일 소스. */
export function mallOfChannel(channel: string): MallId {
  return (BRAND_CHANNELS.harriot as string[]).includes(channel) ? "harriot" : "paulvice";
}

/**
 * 상품 1개의 단위 원가. 재고 매핑과 달리 **원가 추정 전용**이라 느슨한 폴백을 허용한다
 * (재고는 오차감이 위험하지만, 원가는 0 으로 두는 쪽이 더 크게 틀린다).
 *   ① 재고 매핑(옵션맵 → 상품명 → 채널코드 사전)
 *   ② 포함 매칭 — 채널 상품명 안에 카페24 상품명이 통째로 들어 있으면(가장 긴 것)
 *      예) "해리엇 설월 SEOLWOL 문페이즈 남성 가죽시계" ⊃ "설월"
 *   ③ 상품군 평균 — 색상을 알 수 없는 합본 리스팅은 같은 상품군의 평균 원가
 *      예) "해리엇 기원 KI:WON 시계" → 기원 백색·흑색·비취색 평균
 *      한 단어 키("하트"·"큐빅")는 너무 흔해서 **상품명 맨 앞**에 있을 때만, 두 단어 키는 어디에 있어도 인정.
 * ⚠️ 밴드·스트랩은 ②③을 타지 않는다 — "가죽밴드 (기원·설월 호환)" 이 시계 원가로 잡히던 것 방지.
 */
export function unitCostOf(
  channel: string,
  item: { sku?: string; name?: string },
  ctx: CogsContext,
): number | undefined {
  const m = ctx.malls[mallOfChannel(channel)];
  const costOf = (code: string | null | undefined) => {
    if (!code) return undefined;
    return m.cogs[m.alias[code] ?? code];
  };
  const direct = costOf(matchChannelItemToSku(item, m.nameMap, ctx.skuMaps[channel] ?? {}, ctx.optMaps[channel]));
  if (direct !== undefined) return direct;

  const raw = String(item.name || "");
  if (/밴드|스트랩|strap|band|호환/i.test(raw)) return undefined;
  // 채널 상품명 앞의 [태그]·"홍보 문구" 는 떼고 본다
  const cleaned = raw.replace(/\[[^\]]*\]/g, " ").replace(/["“][^"”]*["”]/g, " ");
  const n = normProductName(cleaned).replace(/^(해리엇|harriot)/i, "");
  if (!n) return undefined;
  let best: { len: number; cost: number } | null = null;
  for (const [nm, code] of m.nameMap) {
    if (nm.length < 2 || !n.includes(nm)) continue;
    const c = costOf(code);
    if (c !== undefined && (!best || nm.length > best.len)) best = { len: nm.length, cost: c };
  }
  if (best) return best.cost;

  let fam: { len: number; cost: number } | null = null;
  const consider = (key: string, codes: string[], ok: boolean) => {
    if (!ok) return;
    const costs = codes.map((c) => costOf(c)).filter((c): c is number => c !== undefined && c > 0);
    if (!costs.length) return;
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    if (!fam || key.length > fam.len) fam = { len: key.length, cost: avg };
  };
  for (const [key, codes] of Object.entries(m.families2)) consider(key, codes, n.includes(key));
  for (const [key, codes] of Object.entries(m.families)) consider(key, codes, n.startsWith(key));
  return (fam as { len: number; cost: number } | null)?.cost;
}

/** 업로드 1건의 원가율(0~1)과 매칭 실패 상품명. 매칭된 매출이 없으면 rate=null. */
export function uploadCostRate(
  channel: string,
  upload: PerUpload,
  ctx: CogsContext,
): { rate: number | null; unmatched: string[] } {
  let cost = 0;
  let rev = 0;
  const unmatched: string[] = [];
  for (const it of upload.data.topProducts ?? []) {
    const sold = Number(it.sold) || 0;
    const revenue = Number(it.revenue) || 0;
    if (sold <= 0 || revenue <= 0) continue;
    const unit = unitCostOf(channel, { sku: it.sku, name: it.name }, ctx);
    if (unit === undefined) {
      if (it.name) unmatched.push(it.name);
      continue;
    }
    cost += unit * sold;
    rev += revenue;
  }
  if (rev <= 0) return { rate: null, unmatched };
  return { rate: Math.min(1, Math.max(0, cost / rev)), unmatched };
}

/** 업로드들의 빈 dailyCogs 를 원가율 추정으로 채워 돌려준다(저장소는 건드리지 않는다). */
export function enrichUploadsWithCogs(
  channel: UploadableChannel | string,
  uploads: PerUpload[],
  ctx: CogsContext,
): PerUpload[] {
  return uploads.map((up) => {
    const { rate } = uploadCostRate(channel, up, ctx);
    if (rate === null) return up;
    const have = new Map<string, number>();
    for (const c of up.data.dailyCogs ?? []) if (c.cost > 0) have.set(c.date, c.cost);
    let filled = false;
    for (const d of up.data.dailyRevenue ?? []) {
      if (have.has(d.date) || !(d.revenue > 0)) continue;
      have.set(d.date, Math.round(d.revenue * rate));
      filled = true;
    }
    if (!filled) return up;
    const dailyCogs = [...have].map(([date, cost]) => ({ date, cost })).sort((a, b) => a.date.localeCompare(b.date));
    return { ...up, data: { ...up.data, dailyCogs, cogsEstimated: true } };
  });
}
