"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Package, AlertTriangle, XCircle, TrendingDown,
  Search, SlidersHorizontal, RefreshCw, Link, Plus, EyeOff,
  CloudUpload, Check, Loader2, ChevronDown, ChevronUp, X,
} from "lucide-react";
import {
  buildInventoryProducts,
  updateEntry,
  saveProductsCache,
  loadProductsCache,
  loadManualProducts,
  deleteManualProduct,
  hideProduct,
  loadHiddenSkus,
  clearHiddenSkus,
  syncInventoryFromServer,
  syncManualProductsFromServer,
  syncHiddenSkusFromServer,
  calcAgingStatus,
  AGING_CONFIG,
  type ProductInfo,
  type InventoryProduct,
} from "@/lib/inventoryStorage";
import ProductCard from "./ProductCard";
import StockEditModal from "./StockEditModal";
import AddProductModal from "./AddProductModal";

// ── 채널 판매 수량 집계 ────────────────────────────────────────────────────

/**
 * 카페24 판매(API 직접) + 다른 채널 업로드(/api/profit/channel-uploads)의
 * topProducts를 모두 합산해서 sku → { channelId: sold } 형태로 반환.
 *
 * channelUploads: { wconcept: { topProducts: [{sku, sold}, ...] }, musinsa: ..., '29cm': ..., groupbuy: ..., sixshop: ..., naver_smartstore: ..., sixshop_global: ... }
 */
function buildSoldBySku(
  cafe24Products: { sku: string; sold: number }[],
  channelUploads: Record<string, { topProducts?: Array<{ sku: string; sold: number }> }>,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  const add = (sku: string, channel: string, sold: number) => {
    if (!sku || !sold) return;
    if (!result[sku]) result[sku] = {};
    result[sku][channel] = (result[sku][channel] ?? 0) + sold;
  };
  for (const p of cafe24Products) add(p.sku, "cafe24", p.sold);
  for (const [channel, data] of Object.entries(channelUploads)) {
    for (const p of data?.topProducts ?? []) add(p.sku, channel, p.sold);
  }
  return result;
}

type FilterType = "all" | "normal" | "caution" | "urgent" | "critical" | "soldout" | "unset";

const POLL_INTERVAL = 30_000; // 30초

export default function InventoryManager() {
  const [products, setProducts]         = useState<InventoryProduct[]>([]);
  const [editTarget, setEditTarget]     = useState<InventoryProduct | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter]             = useState<FilterType>("all");
  const [activeCategory, setActiveCategory] = useState("전체");
  const [search, setSearch]             = useState("");
  const [loading, setLoading]           = useState(true);
  const [isConnected, setIsConnected]   = useState(false);
  const [hiddenCount, setHiddenCount]   = useState(0);

  // 동기화 상태
  const [syncing, setSyncing]                 = useState(false);
  const [syncResult, setSyncResult]           = useState<{ synced: number; failed: number; results: any[] } | null>(null);
  const [lastSyncTime, setLastSyncTime]       = useState<string | null>(null);
  const [showSyncDetail, setShowSyncDetail]   = useState(false);

  // 매입원가 (COGS) 맵
  const [cogsMap, setCogsMap] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch("/api/profit/cogs")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setCogsMap(j.cogs ?? {});
      })
      .catch(() => {/* 무시 */});
  }, []);

  const handleCogsChange = useCallback(async (sku: string, cost: number) => {
    const res = await fetch("/api/profit/cogs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [sku]: cost }),
    });
    const j = await res.json();
    if (j.ok) setCogsMap(j.cogs ?? {});
  }, []);

  // Cafe24 API + 다른 채널 업로드 결과를 state에 캐싱 — 30초 폴링 때 재호출 안 함
  const cafe24Cache = useState<{ list: ProductInfo[]; sales: { sku: string; sold: number }[] }>({
    list: [], sales: [],
  });
  const [c24, setC24] = cafe24Cache;
  const [channelUploads, setChannelUploads] = useState<
    Record<string, { topProducts?: Array<{ sku: string; sold: number }> }>
  >({});

  /** 제품 목록 재조합 (Cafe24 캐시 + 채널 업로드 + 최신 서버 데이터) */
  const rebuildProducts = useCallback((
    cafe24List: ProductInfo[],
    cafe24Sales: { sku: string; sold: number }[],
    uploads: Record<string, { topProducts?: Array<{ sku: string; sold: number }> }>,
  ) => {
    const manualProducts = loadManualProducts();
    const cafe24Skus = new Set(cafe24List.map((p) => p.sku));
    const uniqueManual = manualProducts.filter((p) => !cafe24Skus.has(p.sku));
    const allProducts = [...cafe24List, ...uniqueManual];
    const hiddenSkus = loadHiddenSkus();
    setHiddenCount(hiddenSkus.size);
    const visible = allProducts.filter((p) => !hiddenSkus.has(p.sku));
    setProducts(buildInventoryProducts(visible, buildSoldBySku(cafe24Sales, uploads)));
  }, []);

  /** 최초 로드 — Cafe24 API + 채널 업로드 + 서버 동기화 */
  const loadProducts = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      syncInventoryFromServer(),
      syncManualProductsFromServer(),
      syncHiddenSkusFromServer().then((arr) => {
        if (arr) localStorage.setItem("paulvice_hidden_skus_v1", JSON.stringify(arr));
      }),
    ]);

    let cafe24List: ProductInfo[] = [];
    let cafe24Sales: { sku: string; sold: number }[] = [];
    let uploads: Record<string, { topProducts?: Array<{ sku: string; sold: number }> }> = {};

    const [productsRes, salesRes, uploadsRes] = await Promise.allSettled([
      fetch("/api/cafe24/products"),
      fetch("/api/cafe24/data"),
      fetch("/api/profit/channel-uploads"),
    ]);

    if (productsRes.status === "fulfilled" && productsRes.value.ok) {
      const data = await productsRes.value.json();
      cafe24List = data.products ?? [];
      if (cafe24List.length > 0) { saveProductsCache(cafe24List); setIsConnected(true); }
    }
    if (cafe24List.length === 0) { cafe24List = loadProductsCache(); setIsConnected(false); }
    if (salesRes.status === "fulfilled" && salesRes.value.ok) {
      const data = await salesRes.value.json();
      cafe24Sales = (data.topProducts ?? []).map((p: any) => ({ sku: p.sku, sold: p.sold }));
    }
    if (uploadsRes.status === "fulfilled" && uploadsRes.value.ok) {
      const j = await uploadsRes.value.json();
      // j.uploads = { wconcept: { data: MultiChannelData, meta: ... }, ... }
      for (const [channel, entry] of Object.entries((j.uploads ?? {}) as Record<string, { data?: { topProducts?: Array<{ sku: string; sold: number }> } }>)) {
        const tp = entry?.data?.topProducts;
        if (tp?.length) uploads[channel] = { topProducts: tp };
      }
    }

    setC24({ list: cafe24List, sales: cafe24Sales });
    setChannelUploads(uploads);
    rebuildProducts(cafe24List, cafe24Sales, uploads);
    setLoading(false);
  }, [rebuildProducts, setC24]);

  /** 30초 폴링 — Supabase 동기화만 (Cafe24 재호출 없음) */
  const pollFromServer = useCallback(async () => {
    await Promise.all([
      syncInventoryFromServer(),
      syncManualProductsFromServer(),
      syncHiddenSkusFromServer().then((arr) => {
        if (arr) localStorage.setItem("paulvice_hidden_skus_v1", JSON.stringify(arr));
      }),
    ]);
    rebuildProducts(c24.list, c24.sales, channelUploads);
  }, [c24, channelUploads, rebuildProducts]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // 마지막 동기화 시간 로드
  useEffect(() => {
    fetch("/api/cafe24/inventory-sync")
      .then(r => r.json())
      .then(d => {
        const logs = d.logs ?? [];
        if (logs.length > 0) setLastSyncTime(logs[0].timestamp);
      })
      .catch(() => {});
  }, []);

  // 수동 동기화 실행
  const handleSync = useCallback(async (skus?: string[]) => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/cafe24/inventory-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skus }),
      });

      // JSON이 아닌 응답(타임아웃/서버 HTML 에러 페이지) 안전 처리
      const ct = res.headers.get("content-type") ?? "";
      let data: any = null;
      if (ct.includes("application/json")) {
        data = await res.json();
      } else {
        await res.text(); // body 소비
        throw new Error(
          res.status === 504
            ? "동기화 시간 초과 — 카페24 API 응답이 느립니다. 잠시 후 다시 시도해주세요."
            : `서버 오류 (HTTP ${res.status})`
        );
      }

      if (!res.ok) throw new Error(data?.error ?? `동기화 실패 (HTTP ${res.status})`);
      setSyncResult({ synced: data.synced, failed: data.failed, results: data.results ?? [] });
      setLastSyncTime(new Date().toISOString());
    } catch (e: any) {
      setSyncResult({
        synced: 0,
        failed: 0,
        results: [{ sku: "-", quantity: 0, ok: false, error: e.message ?? "알 수 없는 오류" }],
      });
    } finally {
      setSyncing(false);
    }
  }, []);

  // 30초마다 자동 동기화
  useEffect(() => {
    const id = setInterval(pollFromServer, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [pollFromServer]);

  const handleSave = useCallback((
    sku: string,
    patch: { initialStock: number; stockInDate: string; manualAdjustment: number; notes: string; categoryOverride: string }
  ) => {
    updateEntry(sku, patch); // localStorage 즉시 업데이트 + 서버 백그라운드 저장

    // products 상태를 직접 업데이트 — localStorage/c24 경유 없이 즉시 반영
    setProducts(prev => prev.map(p => {
      if (p.sku !== sku) return p;
      const newEntry = { ...p.entry, ...patch };
      const currentStock = Math.max(0, newEntry.initialStock + newEntry.manualAdjustment - p.totalSold);
      const daysInStock  = Math.floor((Date.now() - new Date(newEntry.stockInDate).getTime()) / 86_400_000);
      const agingStatus  = calcAgingStatus(daysInStock, currentStock);
      const stockPct     = newEntry.initialStock > 0 ? Math.round((currentStock / newEntry.initialStock) * 100) : 0;
      const category     = newEntry.categoryOverride || p.category;
      return { ...p, entry: newEntry, currentStock, daysInStock, agingStatus, stockPct, category };
    }));
  }, []);

  const handleDelete = useCallback((sku: string) => {
    const product = products.find((p) => p.sku === sku);
    if (!product) return;
    if (product.isManual) {
      deleteManualProduct(sku);
    } else {
      hideProduct(sku);
    }
    setProducts(prev => prev.filter(p => p.sku !== sku));
    setHiddenCount(prev => product.isManual ? prev : prev + 1);
  }, [products]);

  const handleRestoreAll = useCallback(() => {
    clearHiddenSkus();
    setHiddenCount(0);
    rebuildProducts(c24.list, c24.sales, channelUploads);
  }, [c24, channelUploads, rebuildProducts]);

  // ── 카테고리 목록 ──────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of products) {
      if (p.category) cats.add(p.category);
    }
    return ["전체", ...Array.from(cats).sort()];
  }, [products]);

  // ── 통계 ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    products.length,
    soldout:  products.filter((p) => p.currentStock === 0 && p.entry.initialStock > 0).length,
    lowStock: products.filter((p) => p.stockPct <= 20 && p.currentStock > 0).length,
    aging:    products.filter((p) => p.agingStatus !== "normal" && p.currentStock > 0).length,
    unset:    products.filter((p) => p.entry.initialStock === 0).length,
  }), [products]);

  // ── 필터링 ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = products;

    // 카테고리 필터
    if (activeCategory !== "전체") {
      list = list.filter((p) => p.category === activeCategory);
    }

    // 텍스트 검색
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }

    // 상태 필터
    switch (filter) {
      case "soldout":  list = list.filter((p) => p.currentStock === 0 && p.entry.initialStock > 0); break;
      case "caution":
      case "urgent":
      case "critical": list = list.filter((p) => p.agingStatus === filter && p.currentStock > 0); break;
      case "unset":    list = list.filter((p) => p.entry.initialStock === 0); break;
      case "normal":   list = list.filter((p) => p.agingStatus === "normal" && p.currentStock > 0); break;
    }

    const order: Record<string, number> = { critical: 0, urgent: 1, caution: 2, normal: 3 };
    return [...list].sort((a, b) => {
      if (a.entry.initialStock === 0 && b.entry.initialStock !== 0) return 1;
      if (a.entry.initialStock !== 0 && b.entry.initialStock === 0) return -1;
      if (a.currentStock === 0 && b.currentStock > 0) return 1;
      if (a.currentStock > 0 && b.currentStock === 0) return -1;
      return (order[a.agingStatus] ?? 4) - (order[b.agingStatus] ?? 4);
    });
  }, [products, filter, activeCategory, search]);

  const STATUS_FILTERS: { id: FilterType; label: string; count?: number; color?: string }[] = [
    { id: "all",      label: "전체",     count: stats.total },
    { id: "critical", label: "긴급소진", count: products.filter((p) => p.agingStatus === "critical" && p.currentStock > 0).length, color: "text-red-600" },
    { id: "urgent",   label: "소진필요", count: products.filter((p) => p.agingStatus === "urgent"   && p.currentStock > 0).length, color: "text-orange-600" },
    { id: "caution",  label: "판매촉진", count: products.filter((p) => p.agingStatus === "caution"  && p.currentStock > 0).length, color: "text-yellow-600" },
    { id: "soldout",  label: "품절",     count: stats.soldout, color: "text-zinc-400" },
    { id: "unset",    label: "미입력",   count: stats.unset, color: "text-violet-500" },
  ].filter((f) => f.id === "all" || (f.count ?? 0) > 0) as { id: FilterType; label: string; count?: number; color?: string }[];

  // ── 미연결 + 캐시 없음 ────────────────────────────────────────────────
  if (!loading && products.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-6 py-20 text-center">
        <Link size={40} className="mx-auto mb-4 text-zinc-300" />
        <h2 className="text-lg font-semibold text-zinc-700 dark:text-zinc-300 mb-2">카페24 연결이 필요합니다</h2>
        <p className="text-sm text-zinc-400 mb-6">카페24에 연결하면 실제 제품 목록을 불러와 재고를 관리할 수 있습니다.</p>
        <div className="flex items-center justify-center gap-3">
          <a href="/api/auth/login" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl px-6 py-3 transition-colors text-sm">
            카페24 연결하기
          </a>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold rounded-xl px-6 py-3 transition-colors text-sm hover:bg-zinc-50"
          >
            <Plus size={15} />
            수동으로 추가
          </button>
        </div>
        {showAddModal && (
          <AddProductModal
            existingSkus={new Set(products.map((p) => p.sku))}
            categories={[]}
            onSave={loadProducts}
            onClose={() => setShowAddModal(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">

      {/* 연결 상태 배너 */}
      {!isConnected && products.length > 0 && (
        <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 mb-6 text-sm">
          <span className="text-amber-700 dark:text-amber-300">카페24 미연결 — 마지막으로 불러온 제품 목록을 표시 중입니다.</span>
          <a href="/api/auth/login" className="ml-4 shrink-0 font-semibold text-amber-700 dark:text-amber-300 underline underline-offset-2 hover:opacity-70">재연결 →</a>
        </div>
      )}

      {/* 숨긴 상품 복원 배너 */}
      {hiddenCount > 0 && (
        <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 mb-6 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
            <EyeOff size={14} />
            숨긴 상품 {hiddenCount}개
          </span>
          <button onClick={handleRestoreAll} className="font-semibold text-violet-600 hover:text-violet-700 underline underline-offset-2">
            모두 복원
          </button>
        </div>
      )}

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { icon: Package,      label: "전체 상품",    value: stats.total,    color: "text-violet-600", bg: "bg-violet-50" },
          { icon: XCircle,      label: "품절",          value: stats.soldout,  color: "text-zinc-500",   bg: "bg-zinc-50" },
          { icon: TrendingDown, label: "재고 20% 미만", value: stats.lowStock, color: "text-red-500",    bg: "bg-red-50" },
          { icon: AlertTriangle,label: "에이징 경고",   value: stats.aging,    color: "text-orange-500", bg: "bg-orange-50" },
        ].map(({ icon: Icon, label, value, color, bg }) => (
          <div key={label} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 flex items-center gap-3">
            <div className={`${bg} rounded-xl p-2.5`}>
              <Icon size={18} className={color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-zinc-800 dark:text-zinc-100">{value}</p>
              <p className="text-xs text-zinc-400">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 카페24 동기화 */}
      {isConnected && (
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-3">
              <CloudUpload size={16} className="text-blue-500" />
              <div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">카페24 재고 동기화</p>
                <p className="text-[11px] text-zinc-400">
                  {lastSyncTime
                    ? `마지막 동기화: ${new Date(lastSyncTime).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                    : "아직 동기화한 적 없음"}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleSync()}
              disabled={syncing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {syncing ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
              {syncing ? "동기화 중..." : "지금 동기화"}
            </button>
          </div>

          {/* 동기화 결과 */}
          {syncResult && (
            <div className={`rounded-xl border px-4 py-3 ${
              syncResult.failed === 0
                ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
                : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {syncResult.failed === 0 ? (
                    <Check size={14} className="text-emerald-500" />
                  ) : (
                    <AlertTriangle size={14} className="text-amber-500" />
                  )}
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    성공 {syncResult.synced}개
                    {syncResult.failed > 0 && <span className="text-amber-600"> · 실패 {syncResult.failed}개</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {syncResult.results.length > 0 && (
                    <button
                      onClick={() => setShowSyncDetail(!showSyncDetail)}
                      className="text-[11px] text-zinc-400 hover:text-zinc-600 flex items-center gap-0.5"
                    >
                      상세 {showSyncDetail ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  )}
                  <button onClick={() => setSyncResult(null)} className="text-zinc-300 hover:text-zinc-500">
                    <X size={14} />
                  </button>
                </div>
              </div>
              {showSyncDetail && (
                <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 space-y-1 max-h-40 overflow-y-auto">
                  {syncResult.results.map((r, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[200px]">{r.sku}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-400">수량: {r.quantity}</span>
                        {r.ok ? (
                          <span className="text-emerald-500 font-medium">성공</span>
                        ) : (
                          <span className="text-red-500 font-medium">{r.error}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 카테고리 탭 */}
      {categories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                activeCategory === cat
                  ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm"
                  : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* 검색 + 상태 필터 + 액션 버튼 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text" value={search}
            onChange={(e) => { setSearch(e.target.value); if (syncResult) setSyncResult(null); }}
            placeholder="상품명 또는 SKU 검색..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal size={15} className="text-zinc-400 shrink-0" />
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                filter === f.id
                  ? "bg-violet-600 text-white shadow-sm"
                  : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300"
              }`}
            >
              <span>{f.label}</span>
              {f.count !== undefined && (
                <span className={`${filter === f.id ? "opacity-70" : (f.color ?? "text-zinc-400")}`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
          <button onClick={loadProducts} className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 transition-colors" title="새로고침">
            <RefreshCw size={14} className={loading ? "animate-spin text-violet-500" : "text-zinc-400"} />
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-medium transition-colors"
          >
            <Plus size={14} />
            상품 추가
          </button>
        </div>
      </div>

      {/* 미입력 안내 */}
      {stats.unset > 0 && filter === "all" && !search && activeCategory === "전체" && (
        <div className="flex items-center bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl px-4 py-3 mb-6 text-sm">
          <span className="text-violet-700 dark:text-violet-300">
            재고가 입력되지 않은 상품이 <strong>{stats.unset}개</strong> 있습니다. 카드를 hover하면 나타나는 "재고 수정" 버튼으로 초기 재고를 입력해주세요.
          </span>
        </div>
      )}

      {/* 상품 그리드 */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden animate-pulse">
              <div className="h-40 bg-zinc-200 dark:bg-zinc-800" />
              <div className="p-4 space-y-2">
                <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-3/4" />
                <div className="h-6 bg-zinc-200 dark:bg-zinc-700 rounded w-1/2" />
                <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-zinc-400">
          <Package size={40} className="mx-auto mb-3 opacity-30" />
          <p>조건에 맞는 상품이 없습니다</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((product) => (
            <ProductCard
              key={product.sku}
              product={product}
              cogs={cogsMap[product.sku]}
              onEdit={setEditTarget}
              onDelete={handleDelete}
              onCogsChange={handleCogsChange}
            />
          ))}
        </div>
      )}

      {/* 편집 모달 */}
      {editTarget && (
        <StockEditModal
          product={editTarget}
          categories={categories.filter((c) => c !== "전체")}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* 수동 추가 모달 */}
      {showAddModal && (
        <AddProductModal
          existingSkus={new Set(products.map((p) => p.sku))}
          categories={categories.filter((c) => c !== "전체")}
          onSave={loadProducts}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
