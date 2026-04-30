/**
 * 폴바이스 × 바이소이 공동구매 — 16개 SKU 복제 작업.
 *
 * 안전 장치:
 *   - action=preview  : 16개 원본 찾기 (DB 변경 X, 검증만)
 *   - action=test     : 백업 + 카테고리 생성 + 1번 SKU 만 테스트 복제
 *   - action=remaining: 2~16번 일괄 복제 (test 완료 후 사용자 승인 필요)
 *   - action=rollback : 복제된 -BYSOY SKU 전부 비공개 삭제 (display=F → 실제 delete)
 *
 * 본 상품은 절대 수정하지 않음.
 * 복제본은 모두 display=F (비공개) 로 생성.
 * 옵션(각인/무료포장)은 v1 미포함 — 필요 시 별도 호출.
 */
import { cafe24Get, cafe24Post } from "@/lib/cafe24Client";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PlannedClone {
  idx:           number;
  sourceName:    string;
  line:          string;
  priceNew:      number;
  productCode?:  string; // Excel 기반 정확 매핑 (있으면 코드로 직접 fetch)
}

// 출처: 공구 제품 SKU.xlsx (사용자 제공)
const PLAN: PlannedClone[] = [
  // 에끌라 오벌 — 78,000원
  { idx: 1,  sourceName: "폴바이스 에끌라 오벌 워치 - 골드",                  line: "에끌라 오벌",        priceNew: 78000,  productCode: "P00000HO" },
  { idx: 2,  sourceName: "폴바이스 에끌라 오벌 워치 - 실버",                  line: "에끌라 오벌",        priceNew: 78000,  productCode: "P00000HN" },
  // 오드리 — 78,000원
  { idx: 3,  sourceName: "오드리 화이트 브라운 가죽 시계",                    line: "오드리",            priceNew: 78000,  productCode: "P00000GA" },
  { idx: 4,  sourceName: "오드리 핑크 브라운 가죽 시계",                      line: "오드리",            priceNew: 78000,  productCode: "P00000FZ" },
  { idx: 5,  sourceName: "오드리 블랙 블랙 가죽 시계",                        line: "오드리",            priceNew: 78000,  productCode: "P00000GC" },
  { idx: 6,  sourceName: "오드리 핑크 그레이 가죽 시계",                      line: "오드리",            priceNew: 78000,  productCode: "P00000GB" },
  { idx: 7,  sourceName: "오드리 네이비 화이트 가죽 시계",                    line: "오드리",            priceNew: 78000,  productCode: "P00000GD" },
  // 미니엘 쁘띠 가죽 — 99,000원
  { idx: 8,  sourceName: "미니엘 쁘띠 핑크 챠콜 가죽 여성시계",                line: "미니엘 쁘띠 가죽",    priceNew: 99000,  productCode: "P00000CX" },
  { idx: 9,  sourceName: "미니엘 쁘띠 블랙 브라운 가죽 여성시계",              line: "미니엘 쁘띠 가죽",    priceNew: 99000,  productCode: "P00000CR" },
  { idx: 10, sourceName: "미니엘 쁘띠 아쿠아 화이트",                          line: "미니엘 쁘띠 가죽",    priceNew: 99000,  productCode: "P00000CY" },
  { idx: 11, sourceName: "미니엘 쁘띠 선셋 올리브 가죽 여성시계",              line: "미니엘 쁘띠 가죽",    priceNew: 99000,  productCode: "P00000GM" },
  // 미니엘 쁘띠 메탈 — 109,000원
  { idx: 12, sourceName: "미니엘 쁘띠 화이트 로즈골드",                        line: "미니엘 쁘띠 메탈",    priceNew: 109000, productCode: "P00000CT" },
  { idx: 13, sourceName: "미니엘 쁘띠 핑크 로즈골드 메탈 여성시계",             line: "미니엘 쁘띠 메탈",    priceNew: 109000, productCode: "P00000FT" },
  { idx: 14, sourceName: "미니엘 쁘띠 선셋 로즈골드",                          line: "미니엘 쁘띠 메탈",    priceNew: 109000, productCode: "P00000IK" },
  { idx: 15, sourceName: "미니엘 쁘띠 아쿠아 로즈골드",                        line: "미니엘 쁘띠 메탈",    priceNew: 109000, productCode: "P00000CV" },
  { idx: 16, sourceName: "미니엘 쁘띠 블랙 로즈골드",                          line: "미니엘 쁘띠 메탈",    priceNew: 109000, productCode: "P00000CU" },
];

const CATEGORY_NAME = "바이소이 공구";
const NAME_SUFFIX   = " [바이소이 공구]";
const CODE_SUFFIX   = "-BYSOY";

const BACKUP_KEY    = "bysoy_clone:source_backup";
const CATEGORY_KEY  = "bysoy_clone:category_no";
const MAPPING_KEY   = "bysoy_clone:mapping";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

interface RawProduct {
  product_no:       number;
  product_code?:    string;
  product_name?:    string;
  price?:           string;
  retail_price?:    string;
  supply_price?:    string;
  display?:         "T" | "F";
  selling?:         "T" | "F";
  list_image?:      string | null;
  detail_image?:    string | null;
  tiny_image?:      string | null;
  small_image?:     string | null;
  summary_description?: string;
  description?:     string;
  mobile_description?: string;
  product_weight?:  string;
  manufacturer_code?: string;
  trend_code?:      string;
  brand_code?:      string;
  origin_classification?: string;
  origin_place_no?: number;
  origin_place_value?: string;
  payment_info?:    string;
  shipping_info?:   string;
  exchange_info?:   string;
  service_info?:    string;
}

// ── 원본 상품 검색 ─────────────────────────────────────────────────────────

/** 모든 상품 한 번에 페치 후 in-memory 매핑 — Cafe24 API 가 product_code 검색 파라미터를
 *  안 받아서 전체 list 받아 client side 매칭이 가장 안정적. 단일 sync 내 캐시. */
let allProductsCache: Map<string, RawProduct> | null = null;

async function buildProductCodeMap(token: string): Promise<Map<string, RawProduct>> {
  if (allProductsCache) return allProductsCache;
  const map = new Map<string, RawProduct>();
  let offset = 0;
  const LIMIT = 100;
  while (true) {
    const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    const data = await cafe24Get(`/api/v2/admin/products?${qs}`, token);
    const batch = (data.products ?? []) as RawProduct[];
    for (const p of batch) {
      const code = (p.product_code ?? "").trim();
      if (code) map.set(code, p);
    }
    if (batch.length < LIMIT) break;
    offset += LIMIT;
    if (offset > 2000) break; // 안전장치 (paulvice 제품 수 가정)
  }
  allProductsCache = map;
  return map;
}

async function findByCode(token: string, code: string): Promise<RawProduct | null> {
  const map = await buildProductCodeMap(token);
  return map.get(code.trim()) ?? null;
}

/** 정확 이름 우선, 부분일치 fallback. 이미 -BYSOY 인 건 제외. */
async function findSourceProduct(token: string, name: string): Promise<RawProduct | null> {
  // 정확 매치 시도
  const qs = new URLSearchParams({
    product_name: name,
    limit:        "100",
  });
  const data = await cafe24Get(`/api/v2/admin/products?${qs}`, token);
  const candidates: RawProduct[] = (data.products ?? []).filter(
    (p: RawProduct) =>
      !(p.product_code ?? "").includes(CODE_SUFFIX) &&
      !(p.product_name ?? "").includes(NAME_SUFFIX),
  );

  // 정확 일치 우선
  const exact = candidates.find((p) => (p.product_name ?? "").trim() === name.trim());
  if (exact) return exact;
  // 길이가 같은 가장 가까운 것 (부분 매치)
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) => Math.abs((a.product_name?.length ?? 0) - name.length) - Math.abs((b.product_name?.length ?? 0) - name.length),
  )[0];
}

/** 상품 단건 상세 조회 (복제 시 사용) */
async function getProductDetail(token: string, productNo: number): Promise<RawProduct | null> {
  try {
    const data = await cafe24Get(`/api/v2/admin/products/${productNo}`, token);
    return data.product ?? null;
  } catch {
    return null;
  }
}

// ── 카테고리 ─────────────────────────────────────────────────────────────

async function findCategoryByName(token: string, name: string): Promise<number | null> {
  // Cafe24 categories limit max=100. 페이징으로 누적 검색.
  let offset = 0;
  while (offset < 1000) {
    const data = await cafe24Get(
      `/api/v2/admin/categories?limit=100&offset=${offset}&shop_no=1`,
      token,
    );
    const list = (data.categories ?? []) as Array<{ category_no: number; category_name: string }>;
    const cat = list.find((c) => c.category_name === name);
    if (cat) return cat.category_no;
    if (list.length < 100) return null;
    offset += 100;
  }
  return null;
}

async function createPrivateCategory(token: string, name: string): Promise<number> {
  const res = await cafe24Post(`/api/v2/admin/categories`, token, {
    shop_no: 1,
    request: {
      category_name: name,
      parent_category_no: 1, // 최상위
      use_display: "F",       // 비공개
      display_type: "1",
    },
  });
  const no = res?.category?.category_no;
  if (!no) throw new Error(`카테고리 생성 응답 형식 오류: ${JSON.stringify(res).slice(0, 300)}`);
  return no;
}

async function ensureCategory(token: string): Promise<number> {
  const db = getDb();
  // 캐시 확인
  if (db) {
    const { data } = await db
      .from("kv_store")
      .select("data")
      .eq("key", CATEGORY_KEY)
      .maybeSingle();
    const cached = data?.data as number | undefined;
    if (cached) return cached;
  }
  // 카페24 에서 검색
  let no = await findCategoryByName(token, CATEGORY_NAME);
  if (!no) no = await createPrivateCategory(token, CATEGORY_NAME);
  if (db) {
    await db.from("kv_store").upsert(
      { key: CATEGORY_KEY, data: no, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  }
  return no;
}

// ── 백업 ─────────────────────────────────────────────────────────────────

async function saveBackup(products: Array<{ idx: number; product: RawProduct }>): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("kv_store").upsert(
    {
      key:        BACKUP_KEY,
      data:       { savedAt: new Date().toISOString(), products },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

// ── 매핑 결과 ────────────────────────────────────────────────────────────

interface CloneResult {
  idx:                number;
  sourceProductNo:    number;
  sourceProductCode:  string;
  sourceProductName:  string;
  newProductNo?:      number;
  newProductCode:     string;
  newProductName:     string;
  priceNew:           number;
  status:             "success" | "skipped_duplicate" | "failed";
  error?:             string;
}

async function loadMapping(): Promise<CloneResult[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", MAPPING_KEY)
    .maybeSingle();
  return (data?.data as CloneResult[] | null) ?? [];
}

async function saveMapping(mapping: CloneResult[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("kv_store").upsert(
    { key: MAPPING_KEY, data: mapping, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

// ── 복제 ─────────────────────────────────────────────────────────────────

async function checkCodeExists(token: string, code: string): Promise<boolean> {
  try {
    const data = await cafe24Get(
      `/api/v2/admin/products?product_code=${encodeURIComponent(code)}&limit=10`,
      token,
    );
    return ((data.products ?? []) as RawProduct[]).some(
      (p) => (p.product_code ?? "").trim() === code.trim(),
    );
  } catch {
    return false;
  }
}

async function cloneProduct(
  token: string,
  source: RawProduct,
  newCode: string,
  newName: string,
  priceNew: number,
  categoryNo: number,
): Promise<RawProduct> {
  const body = {
    shop_no: 1,
    request: {
      product_name:        newName,
      product_code:        newCode,
      // 가격
      price:               String(priceNew),
      retail_price:        String(priceNew),       // 정가 = 판매가 (할인 없음)
      supply_price:        source.supply_price ?? String(priceNew),
      // 노출 상태
      display:             "F",                    // 비공개
      selling:             "T",                    // 판매중 (display 만 비공개라 사이트엔 안 뜸)
      // 이미지 (URL 그대로)
      list_image:          source.list_image  ?? "",
      detail_image:        source.detail_image ?? "",
      tiny_image:          source.tiny_image  ?? "",
      small_image:         source.small_image ?? "",
      // 설명
      summary_description: source.summary_description ?? "",
      description:         source.description         ?? "",
      mobile_description:  source.mobile_description  ?? "",
      // 카테고리
      add_category_no:     [{ category_no: categoryNo }],
      // 메타
      product_weight:      source.product_weight,
      manufacturer_code:   source.manufacturer_code,
      trend_code:          source.trend_code,
      brand_code:          source.brand_code,
      origin_classification: source.origin_classification,
      origin_place_no:     source.origin_place_no,
      origin_place_value:  source.origin_place_value,
      payment_info:        source.payment_info,
      shipping_info:       source.shipping_info,
      exchange_info:       source.exchange_info,
      service_info:        source.service_info,
    },
  };
  const res = await cafe24Post(`/api/v2/admin/products`, token, body);
  const newProduct = res?.product;
  if (!newProduct?.product_no) {
    throw new Error(`상품 생성 응답 형식 오류: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return newProduct as RawProduct;
}

// ── 핸들러 ────────────────────────────────────────────────────────────────

async function findPlanned(token: string, p: PlannedClone): Promise<RawProduct | null> {
  // 1순위: productCode (Excel 정확 매핑)
  if (p.productCode) {
    const byCode = await findByCode(token, p.productCode);
    if (byCode) return byCode;
  }
  // 2순위: 이름 fuzzy
  return findSourceProduct(token, p.sourceName);
}

async function preview(token: string) {
  const found: Array<{ plan: PlannedClone; product: RawProduct | null }> = [];
  for (const p of PLAN) {
    const src = await findPlanned(token, p);
    found.push({ plan: p, product: src });
  }
  const missing = found.filter((f) => !f.product).map((f) => f.plan.sourceName);
  return {
    ok:      missing.length === 0,
    foundCount:   found.filter((f) => f.product).length,
    totalCount:   PLAN.length,
    missing,
    matches: found.map((f) => ({
      idx:          f.plan.idx,
      planned:      f.plan.sourceName,
      matched:      f.product?.product_name ?? null,
      productCode:  f.product?.product_code ?? null,
      productNo:    f.product?.product_no   ?? null,
      currentPrice: f.product?.price        ?? null,
      newPrice:     f.plan.priceNew,
      newCode:      f.product?.product_code ? f.product.product_code + CODE_SUFFIX : null,
      newName:      f.product ? (f.product.product_name ?? "") + NAME_SUFFIX : null,
    })),
  };
}

async function executeCloneOne(
  token: string,
  plan: PlannedClone,
  source: RawProduct,
  categoryNo: number,
): Promise<CloneResult> {
  const newCode = (source.product_code ?? `P${source.product_no}`) + CODE_SUFFIX;
  const newName = (source.product_name ?? plan.sourceName) + NAME_SUFFIX;

  // 중복 체크
  if (await checkCodeExists(token, newCode)) {
    return {
      idx:               plan.idx,
      sourceProductNo:   source.product_no,
      sourceProductCode: source.product_code ?? "",
      sourceProductName: source.product_name ?? "",
      newProductCode:    newCode,
      newProductName:    newName,
      priceNew:          plan.priceNew,
      status:            "skipped_duplicate",
      error:             `상품코드 ${newCode} 이미 존재 — 스킵`,
    };
  }

  try {
    // 상세 정보 다시 가져오기 (list 응답엔 일부 필드가 빠짐)
    const detail = (await getProductDetail(token, source.product_no)) ?? source;
    const cloned = await cloneProduct(token, detail, newCode, newName, plan.priceNew, categoryNo);
    return {
      idx:               plan.idx,
      sourceProductNo:   source.product_no,
      sourceProductCode: source.product_code ?? "",
      sourceProductName: source.product_name ?? "",
      newProductNo:      cloned.product_no,
      newProductCode:    cloned.product_code ?? newCode,
      newProductName:    cloned.product_name ?? newName,
      priceNew:          plan.priceNew,
      status:            "success",
    };
  } catch (e) {
    return {
      idx:               plan.idx,
      sourceProductNo:   source.product_no,
      sourceProductCode: source.product_code ?? "",
      sourceProductName: source.product_name ?? "",
      newProductCode:    newCode,
      newProductName:    newName,
      priceNew:          plan.priceNew,
      status:            "failed",
      error:             e instanceof Error ? e.message : String(e),
    };
  }
}

async function testClone(token: string) {
  // 1. 16개 모두 찾고 검증
  const sourceProducts: Array<{ plan: PlannedClone; product: RawProduct }> = [];
  for (const p of PLAN) {
    const src = await findPlanned(token, p);
    if (!src) {
      return {
        ok: false,
        error: `원본 못 찾음: ${p.sourceName} (코드 ${p.productCode ?? "없음"}) — preview 단계 다시 확인 필요`,
        stage: "find",
      };
    }
    sourceProducts.push({ plan: p, product: src });
  }

  // 2. 백업
  await saveBackup(sourceProducts.map((s) => ({ idx: s.plan.idx, product: s.product })));

  // 3. 카테고리 보장
  const categoryNo = await ensureCategory(token);

  // 4. 1번만 복제
  const target = sourceProducts.find((s) => s.plan.idx === 1)!;
  const result = await executeCloneOne(token, target.plan, target.product, categoryNo);

  // 매핑 저장
  const existing = await loadMapping();
  const merged = [...existing.filter((m) => m.idx !== 1), result];
  await saveMapping(merged);

  return {
    ok:           result.status === "success",
    stage:        "test",
    backupSaved:  true,
    backupCount:  sourceProducts.length,
    categoryNo,
    categoryName: CATEGORY_NAME,
    result,
    message: result.status === "success"
      ? `1번 SKU 복제 성공 (비공개 상태) — Cafe24 어드민에서 확인 후 'remaining' 호출하세요.`
      : `1번 SKU 복제 실패 — ${result.error}`,
  };
}

async function remainingClone(token: string) {
  // 백업 + 카테고리 가져오기
  const db = getDb();
  if (!db) return { ok: false, error: "Supabase 미설정" };

  const { data: backupRow } = await db
    .from("kv_store")
    .select("data")
    .eq("key", BACKUP_KEY)
    .maybeSingle();
  const backup = backupRow?.data as { products: Array<{ idx: number; product: RawProduct }> } | null;
  if (!backup?.products?.length) {
    return { ok: false, error: "백업 없음 — 먼저 action=test 호출 필요" };
  }

  const categoryNo = await ensureCategory(token);
  const existing   = await loadMapping();
  const idxAlreadyDone = new Set(
    existing.filter((m) => m.status === "success").map((m) => m.idx),
  );

  const results: CloneResult[] = [...existing];
  for (const plan of PLAN) {
    if (idxAlreadyDone.has(plan.idx)) continue;
    const src = backup.products.find((p) => p.idx === plan.idx)?.product;
    if (!src) {
      results.push({
        idx: plan.idx, sourceProductNo: 0, sourceProductCode: "", sourceProductName: plan.sourceName,
        newProductCode: "", newProductName: "", priceNew: plan.priceNew,
        status: "failed", error: "백업에서 원본 못 찾음",
      });
      continue;
    }
    const r = await executeCloneOne(token, plan, src, categoryNo);
    // 같은 idx 갱신
    const filtered = results.filter((x) => x.idx !== plan.idx);
    filtered.push(r);
    results.length = 0;
    results.push(...filtered);
    await saveMapping(results); // 진행 상황 즉시 저장 — 중간 실패해도 이력 남김

    // 첫 fatal 실패 시 중단 (사용자 명시 요건)
    if (r.status === "failed") {
      return {
        ok: false,
        stage: "remaining",
        completedSoFar: results.filter((x) => x.status === "success").length,
        results: results.sort((a, b) => a.idx - b.idx),
        abortedAt: r.idx,
        error: r.error,
      };
    }
  }

  return {
    ok: true,
    stage: "remaining",
    successCount: results.filter((r) => r.status === "success").length,
    skippedCount: results.filter((r) => r.status === "skipped_duplicate").length,
    failedCount:  results.filter((r) => r.status === "failed").length,
    results: results.sort((a, b) => a.idx - b.idx),
  };
}

// ── 라우트 ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { action?: string };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }

  const action = body.action ?? "";
  if (!["preview", "test", "remaining", "discover", "create_consolidated"].includes(action)) {
    return Response.json({
      ok: false,
      error: "action 필수 (discover / preview / test / remaining / create_consolidated)",
    }, { status: 400 });
  }

  const token = await getValidC24Token();
  if (!token) {
    return Response.json({ ok: false, error: "Cafe24 미연결" }, { status: 401 });
  }

  try {
    if (action === "discover")           return Response.json(await discover(token));
    if (action === "preview")            return Response.json(await preview(token));
    if (action === "test")               return Response.json(await testClone(token));
    if (action === "remaining")          return Response.json(await remainingClone(token));
    if (action === "create_consolidated") return Response.json(await createConsolidated(token));
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), stage: action },
      { status: 500 },
    );
  }
}

// ── create_consolidated: 16종 옵션 가진 단일 통합 상품 생성 ──────────────────

const CONSOLIDATED_PRODUCT_KEY = "bysoy_consolidated:product";
const CONSOLIDATED_PRODUCT_NAME = "폴바이스 × @_bysoy 공동구매";
const CONSOLIDATED_PRODUCT_CODE = "BYSOY-2026-05";
const BASE_PRICE = 78000;

interface ConsolidatedResult {
  ok:           boolean;
  productNo?:   number;
  productCode?: string;
  productName?: string;
  categoryNo?:  number;
  optionsApplied: boolean;
  bagOptionApplied: boolean;
  optionsError?: string;
  bagError?:    string;
  adminUrl?:    string;
  next: string[];
}

async function createConsolidated(token: string): Promise<ConsolidatedResult> {
  // 1. 16개 원본 모두 찾기 (productCode 우선)
  const sources: Array<{ plan: PlannedClone; product: RawProduct }> = [];
  for (const p of PLAN) {
    const src = await findPlanned(token, p);
    if (!src) {
      throw new Error(`원본 못 찾음: ${p.sourceName} (${p.productCode}) — preview 단계 다시 확인 필요`);
    }
    sources.push({ plan: p, product: src });
  }

  // 2. 백업
  await saveBackup(sources.map((s) => ({ idx: s.plan.idx, product: s.product })));

  // 3. 카테고리
  const categoryNo = await ensureCategory(token);

  // 4. 이미 같은 코드 존재하면 abort (중복 방지)
  if (await checkCodeExists(token, CONSOLIDATED_PRODUCT_CODE)) {
    return {
      ok: false,
      optionsApplied: false,
      bagOptionApplied: false,
      optionsError: `상품코드 ${CONSOLIDATED_PRODUCT_CODE} 이미 존재 — 중복 방지 abort. 기존 상품 삭제 후 재시도하거나 어드민에서 직접 수정 사용.`,
      next: [],
    };
  }

  // 5. 상세 정보 (description 등) 첫 SKU 에서 가져옴 — 사용자가 어드민에서 교체 예정
  const firstDetail = (await getProductDetail(token, sources[0].product.product_no)) ?? sources[0].product;

  // 옵션 1: 모델 — 16값 (option_text + additional_amount)
  const modelOptionValues = sources.map((s) => ({
    option_text:       s.plan.sourceName,
    additional_amount: String(s.plan.priceNew - BASE_PRICE),
  }));

  // 옵션 2: 쇼핑백 — 선택 (+1,000원)
  const bagOptionValues = [
    { option_text: "필요 없음",                 additional_amount: "0" },
    { option_text: "쇼핑백 추가 (+1,000원)",     additional_amount: "1000" },
  ];

  const body = {
    shop_no: 1,
    request: {
      product_name:        CONSOLIDATED_PRODUCT_NAME,
      product_code:        CONSOLIDATED_PRODUCT_CODE,
      price:               String(BASE_PRICE),
      retail_price:        String(BASE_PRICE),
      supply_price:        String(BASE_PRICE),
      selling:             "T",
      display:             "F", // 비공개 — 5/19 진열 예약 어드민에서 별도 설정
      list_image:          firstDetail.list_image  ?? "",
      detail_image:        firstDetail.detail_image ?? "",
      tiny_image:          firstDetail.tiny_image  ?? "",
      small_image:         firstDetail.small_image ?? "",
      summary_description: "폴바이스 × @_bysoy 인플루언서 공동구매 (2026.05.19~22 · 4일 한정)",
      description:         firstDetail.description ?? "",
      mobile_description:  firstDetail.mobile_description ?? "",
      add_category_no:     [{ category_no: categoryNo }],
      // 옵션 inline (Cafe24 API 지원 시)
      options: [
        {
          option_name:         "모델",
          option_value:        modelOptionValues,
          required_option:     "T",
          option_display_type: "S",
        },
        {
          option_name:         "쇼핑백",
          option_value:        bagOptionValues,
          required_option:     "F",
          option_display_type: "S",
        },
      ],
    },
  };

  let createdProduct: RawProduct | null = null;
  let optionsApplied = false;
  let bagApplied = false;
  let optionsErr: string | undefined;
  let bagErr: string | undefined;

  // 1차 시도: 옵션 inline 포함 POST
  try {
    const res = await cafe24Post(`/api/v2/admin/products`, token, body);
    createdProduct = res?.product ?? null;
    optionsApplied = true;
    bagApplied     = true;
  } catch (e) {
    optionsErr = e instanceof Error ? e.message : String(e);
    // fallback: 옵션 빼고 기본 상품만 생성
    const fallbackBody = {
      ...body,
      request: { ...body.request, options: undefined as never },
    };
    delete (fallbackBody.request as Record<string, unknown>).options;
    try {
      const res2 = await cafe24Post(`/api/v2/admin/products`, token, fallbackBody);
      createdProduct = res2?.product ?? null;
    } catch (e2) {
      throw new Error(
        `상품 생성 실패. 옵션 포함 1차: ${optionsErr}. 옵션 제외 2차: ${e2 instanceof Error ? e2.message : String(e2)}`,
      );
    }
  }

  if (!createdProduct?.product_no) {
    throw new Error("상품 생성 응답에 product_no 없음");
  }

  // 매핑 저장
  const db = getDb();
  if (db) {
    await db.from("kv_store").upsert(
      {
        key: CONSOLIDATED_PRODUCT_KEY,
        data: {
          createdAt:      new Date().toISOString(),
          productNo:      createdProduct.product_no,
          productCode:    createdProduct.product_code,
          productName:    createdProduct.product_name,
          categoryNo,
          sources:        sources.map((s) => ({ idx: s.plan.idx, name: s.plan.sourceName, productNo: s.product.product_no, productCode: s.product.product_code })),
          optionsApplied,
          bagOptionApplied: bagApplied,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  }

  const adminUrl = `https://eclogin.cafe24.com/Shop/?sub=mkt&page=front_shop1_modify&product_no=${createdProduct.product_no}`;

  const next: string[] = [];
  next.push(`1. 카페24 어드민 들어가서 ${createdProduct.product_no}번 상품 확인`);
  if (!optionsApplied) {
    next.push("2. ⚠️ 옵션 자동 등록 실패 — 어드민 옵션 탭에서 16개 모델 + 쇼핑백 직접 추가 (가격 추가금 +0/+21000/+31000 / 쇼핑백 +1000)");
  } else {
    next.push("2. 16개 모델 옵션 + 쇼핑백 옵션 등록 확인 (옵션별 썸네일은 어드민에서 직접 업로드 — 본 SKU 이미지 URL 참고)");
  }
  next.push("3. 메인 이미지를 사용자가 따로 작업한 이미지로 교체 (현재는 1번 SKU 이미지로 임시)");
  next.push("4. 상세 페이지(description) 공구 전용으로 작성/교체");
  next.push("5. 진열 예약: 5/19 00:00 자동 노출 — 어드민 → 진열관리 → 진열기간 설정");
  next.push("6. 옵션별 재고 확인 — 본 SKU 재고와 별개로 통합 상품 재고는 새로 잡혀있음, 필요 시 조정");

  return {
    ok:               true,
    productNo:        createdProduct.product_no,
    productCode:      createdProduct.product_code,
    productName:      createdProduct.product_name,
    categoryNo,
    optionsApplied,
    bagOptionApplied: bagApplied,
    optionsError:     optionsErr,
    bagError:         bagErr,
    adminUrl,
    next,
  };
}

// ── discover: 라인별 키워드 검색 → 통합 상품 v2 용 ────────────────────────

async function searchByKeyword(token: string, keyword: string, limit = 50): Promise<RawProduct[]> {
  const qs = new URLSearchParams({ product_name: keyword, limit: String(limit) });
  const data = await cafe24Get(`/api/v2/admin/products?${qs}`, token);
  return ((data.products ?? []) as RawProduct[]).filter(
    (p) => !(p.product_code ?? "").includes(CODE_SUFFIX) && !(p.product_name ?? "").includes(NAME_SUFFIX),
  );
}

async function discover(token: string) {
  // 라인별 키워드 + 포함조건 (negative filter 후처리)
  const queries = [
    { line: "에끌라 오벌",       keyword: "에끌라",   priceLineNew: 78000  },
    { line: "오드리",           keyword: "오드리",   priceLineNew: 78000  },
    { line: "미니엘 쁘띠 가죽",  keyword: "미니엘",   priceLineNew: 99000, mustIncludeAny: ["가죽"] },
    { line: "미니엘 쁘띠 메탈",  keyword: "미니엘",   priceLineNew: 109000, mustIncludeAny: ["메탈"] },
  ];

  // 같은 키워드 반복 호출 절약 — 결과 캐시
  const cache = new Map<string, RawProduct[]>();
  async function getCandidates(keyword: string): Promise<RawProduct[]> {
    if (cache.has(keyword)) return cache.get(keyword)!;
    const r = await searchByKeyword(token, keyword);
    cache.set(keyword, r);
    return r;
  }

  const lines = [];
  for (const q of queries) {
    const all = await getCandidates(q.keyword);
    let filtered = all;
    if (q.mustIncludeAny) {
      filtered = filtered.filter((p) =>
        q.mustIncludeAny!.some((kw) => (p.product_name ?? "").includes(kw)),
      );
    }
    // 미니엘은 가죽/메탈로 가르는데, 이름에 둘 다 안 나오면 둘에 모두 후보로 들어가지 않게
    lines.push({
      line:           q.line,
      keyword:        q.keyword,
      priceLineNew:   q.priceLineNew,
      candidateCount: filtered.length,
      candidates:     filtered.map((p) => ({
        product_no:    p.product_no,
        product_code:  p.product_code,
        product_name:  p.product_name,
        price:         p.price,
        list_image:    p.list_image,
        display:       p.display,
        selling:       p.selling,
      })),
    });
  }

  const totalCandidates = lines.reduce((s, l) => s + l.candidateCount, 0);
  return {
    ok: true,
    note: "각 라인의 후보 상품 list. v2 통합 상품 만들 때 이 중 어떤 product_no 를 옵션으로 쓸지 확인 필요. 옵션 분기형 단일 SKU 라면 1라인 1개만 쓰고 그 안 옵션을 그대로 가져옴. 컬러별 분리 SKU 라면 16개 모두 옵션값으로 사용.",
    totalCandidates,
    lines,
  };
}
