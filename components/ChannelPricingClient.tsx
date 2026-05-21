"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { RefreshCw, Upload, AlertTriangle, Link2, Loader2, TrendingDown } from "lucide-react";
import {
  PRICING_CHANNEL_LABEL,
  type PricingChannel,
  type CatalogEntry,
  type UnmatchedChannelProduct,
} from "@/lib/channelPricing/types";

const UPLOAD_CHANNELS: PricingChannel[] = ["wconcept", "musinsa", "29cm", "kakao_gift"];
const COLUMN_CHANNELS: PricingChannel[] = ["cafe24", "wconcept", "musinsa", "29cm", "kakao_gift"];
const LOW_MARGIN = 0.1; // 10% 미만 = 저마진 경고

function krw(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("ko-KR") + "원";
}

interface CatalogResponse {
  ok: boolean;
  entries: CatalogEntry[];
  unmatched: UnmatchedChannelProduct[];
  cogs: Record<string, number>;
  channelStatus: Record<PricingChannel, { hasData: boolean; count: number }>;
  skus: Array<{ sku: string; name: string }>;
  kakaoFeeRate: number;
  error?: string;
}

export default function ChannelPricingClient() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<PricingChannel | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [linkSel, setLinkSel] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState(false);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const selKey = (channel: string, channelCode: string) => `${channel}|${channelCode}`;

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/channel-pricing", { cache: "no-store" });
      const j = (await res.json()) as CatalogResponse;
      if (!j.ok) throw new Error(j.error ?? "조회 실패");
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 데이터 로드 시 미매칭 행의 드롭다운을 추천 후보(있으면)로 미리 채움 — 빠른 일괄 연결용.
  useEffect(() => {
    if (!data) return;
    const seed: Record<string, string> = {};
    for (const u of data.unmatched) {
      seed[selKey(u.channel, u.channelCode)] = u.candidates[0]?.sku ?? "";
    }
    setLinkSel(seed);
  }, [data]);

  const onUpload = async (channel: PricingChannel, file: File) => {
    setUploading(channel);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/channel-pricing/upload?channel=${channel}`, { method: "POST", body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "업로드 실패");
      showToast(`${PRICING_CHANNEL_LABEL[channel]}: ${j.count}건 (가격 ${j.priced}건) 반영`);
      await load();
    } catch (e) {
      showToast(`업로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(null);
    }
  };

  const onBatchLink = async () => {
    const links = (data?.unmatched ?? [])
      .map((u) => ({ channel: u.channel, channelCode: u.channelCode, sku: linkSel[selKey(u.channel, u.channelCode)] }))
      .filter((l) => l.sku); // 선택 안 한(빈) 행은 제외
    if (links.length === 0) {
      showToast("연결할 항목을 드롭다운에서 먼저 선택하세요");
      return;
    }
    setLinking(true);
    try {
      const res = await fetch("/api/channel-pricing/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "연결 실패");
      showToast(`${j.count}건 일괄 연결 완료`);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setLinking(false);
    }
  };

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const cogs = useMemo(() => data?.cogs ?? {}, [data]);
  const unmatched = data?.unmatched ?? [];
  const selectedCount = unmatched.filter((u) => linkSel[selKey(u.channel, u.channelCode)]).length;

  // 경고 집계
  let lowestBreaks = 0;
  let lowMargins = 0;
  for (const e of entries) {
    const ref = e.channels.cafe24?.discount ?? null;
    for (const ch of COLUMN_CHANNELS) {
      const c = e.channels[ch];
      if (!c) continue;
      if (ch !== "cafe24" && ref != null && c.discount != null && c.discount < ref) lowestBreaks++;
      const cogsV = cogs[e.sku];
      if (c.net != null && cogsV != null && cogsV > 0) {
        const m = (c.net - cogsV) / c.net;
        if (m < LOW_MARGIN) lowMargins++;
      }
    }
  }

  // 정렬: 가격 수정 필요(최저가 깨짐·저마진) → 상단, 채널 취급 → 중간, 미취급(카페24만) → 최하단
  const sortedEntries = useMemo(() => {
    const tier = (e: CatalogEntry): number => {
      const ref = e.channels.cafe24?.discount ?? null;
      const cogsV = cogs[e.sku] ?? null;
      let needsFix = false;
      let nonCafe24 = 0;
      for (const ch of COLUMN_CHANNELS) {
        const c = e.channels[ch];
        if (!c) continue;
        if (ch !== "cafe24") nonCafe24++;
        if (ch !== "cafe24" && ref != null && c.discount != null && c.discount < ref) needsFix = true;
        if (c.net != null && cogsV != null && cogsV > 0 && (c.net - cogsV) / c.net < LOW_MARGIN) needsFix = true;
      }
      if (needsFix) return 0;       // 상단: 가격 수정 필요
      if (nonCafe24 > 0) return 1;  // 중간: 채널 취급중
      return 2;                     // 최하단: 미취급(카페24만)
    };
    return [...entries].sort((a, b) => tier(a) - tier(b) || a.name.localeCompare(b.name, "ko"));
  }, [entries, cogs]);

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white text-sm px-4 py-2.5 rounded-full shadow-lg">
          {toast}
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">채널 가격 관리</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            카페24 기준 · 채널별 정가/할인가/실마진 비교 · 최저가·저마진 감시
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 px-3 py-1.5 rounded-full flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> 새로고침
        </button>
      </div>

      {/* 업로드 버튼들 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {UPLOAD_CHANNELS.map((ch) => {
          const st = data?.channelStatus?.[ch];
          return (
            <div key={ch} className="flex items-center">
              <input
                ref={(el) => { fileInputs.current[ch] = el; }}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(ch, f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInputs.current[ch]?.click()}
                disabled={uploading === ch}
                className="text-xs font-medium border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 px-3 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
              >
                {uploading === ch ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {PRICING_CHANNEL_LABEL[ch]} 업로드
                {st?.hasData && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">({st.count})</span>}
              </button>
            </div>
          );
        })}
      </div>

      {/* 경고 요약 */}
      {!loading && entries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <Badge tone={lowestBreaks > 0 ? "red" : "zinc"} icon={<TrendingDown size={12} />}>
            최저가 깨짐 {lowestBreaks}
          </Badge>
          <Badge tone={lowMargins > 0 ? "amber" : "zinc"} icon={<AlertTriangle size={12} />}>
            저마진(&lt;{Math.round(LOW_MARGIN * 100)}%) {lowMargins}
          </Badge>
          <Badge tone={unmatched.length > 0 ? "violet" : "zinc"} icon={<Link2 size={12} />}>
            미매칭 {unmatched.length}
          </Badge>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {/* 미매칭 확인 */}
      {unmatched.length > 0 && (
        <div className="bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="text-sm font-bold text-violet-800 dark:text-violet-200 flex items-center gap-1.5">
              <Link2 size={14} /> 미매칭 상품 — 드롭다운에서 SKU 고른 뒤 일괄 연결 ({unmatched.length})
            </div>
            <button
              onClick={onBatchLink}
              disabled={linking || selectedCount === 0}
              className="text-xs font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              {linking ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
              선택한 {selectedCount}건 일괄 연결
            </button>
          </div>
          <p className="text-[11px] text-violet-600 dark:text-violet-400 mb-2">
            추천 후보가 있으면 미리 채워져 있어요. 틀린 건 바꾸고, 매칭 안 되는 건 “SKU 선택…”으로 비워두면 제외됩니다.
          </p>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {unmatched.map((u, i) => {
              const key = selKey(u.channel, u.channelCode);
              return (
                <UnmatchedRow
                  key={`${u.channel}-${u.channelCode}-${i}`}
                  u={u}
                  allSkus={data?.skus ?? []}
                  value={linkSel[key] ?? ""}
                  onChange={(sku) => setLinkSel((prev) => ({ ...prev, [key]: sku }))}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 매트릭스 */}
      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-zinc-400 gap-2">
          <Loader2 size={16} className="animate-spin" /> 불러오는 중…
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-16">
          카페24 상품이 없거나 토큰 미연결입니다. 카페24 연결 후 채널 파일을 업로드하세요.
        </p>
      ) : (
        <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-xl">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 text-xs">
                <th className="text-left font-semibold px-3 py-2.5 sticky left-0 bg-zinc-50 dark:bg-zinc-900 min-w-[220px]">상품 (SKU)</th>
                <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">원가</th>
                {COLUMN_CHANNELS.map((ch) => (
                  <th key={ch} className="text-right font-semibold px-3 py-2.5 whitespace-nowrap min-w-[120px]">
                    {PRICING_CHANNEL_LABEL[ch]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((e) => {
                const ref = e.channels.cafe24?.discount ?? null;
                const cogsV = cogs[e.sku] ?? null;
                return (
                  <tr key={e.sku} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2 sticky left-0 bg-white dark:bg-zinc-950">
                      <div className="flex items-center gap-2 min-w-0">
                        {e.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={e.image.startsWith("//") ? "https:" + e.image : e.image} alt="" className="w-8 h-8 rounded object-cover shrink-0 bg-zinc-100" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-800 dark:text-zinc-100 max-w-[180px]">{e.name}</div>
                          <div className="text-[10px] text-zinc-400 font-mono">{e.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500 whitespace-nowrap">
                      {cogsV != null ? krw(cogsV) : <span className="text-amber-500">원가?</span>}
                    </td>
                    {COLUMN_CHANNELS.map((ch) => {
                      const c = e.channels[ch];
                      if (!c) return <td key={ch} className="px-3 py-2 text-right text-zinc-300 dark:text-zinc-600">미취급</td>;
                      const breaks = ch !== "cafe24" && ref != null && c.discount != null && c.discount < ref;
                      const margin = c.net != null && cogsV != null && cogsV > 0 ? (c.net - cogsV) / c.net : null;
                      const low = margin != null && margin < LOW_MARGIN;
                      return (
                        <td key={ch} className={`px-3 py-2 text-right whitespace-nowrap ${breaks ? "bg-red-50 dark:bg-red-950/30" : ""}`}>
                          <div className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 flex items-center justify-end gap-1">
                            {breaks && <TrendingDown size={11} className="text-red-500" />}
                            {krw(c.discount)}
                          </div>
                          {c.list != null && c.discount != null && c.list !== c.discount && (
                            <div className="text-[10px] text-zinc-400 line-through tabular-nums">{krw(c.list)}</div>
                          )}
                          <div className={`text-[10px] tabular-nums ${low ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-zinc-400"}`}>
                            {margin != null ? `마진 ${Math.round(margin * 100)}%` : c.net != null ? "원가?" : "정산?"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-zinc-400 mt-3 leading-relaxed">
        · 마진 = (실수령 net − 원가) / 실수령. 원가는 재무관리의 SKU 매입원가를 사용.
        · 카페24 net은 PG 수수료 제외 전(=판매가). · 카카오 net = 할인가 × {Math.round((data?.kakaoFeeRate ?? 0.3) * 100)}% 차감.
        · 빨강 = 카페24보다 싼 채널(최저가 깨짐).
      </p>
    </div>
  );
}

function Badge({ children, tone, icon }: { children: React.ReactNode; tone: "red" | "amber" | "violet" | "zinc"; icon?: React.ReactNode }) {
  const tones = {
    red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    zinc: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold ${tones[tone]}`}>
      {icon} {children}
    </span>
  );
}

function UnmatchedRow({
  u, allSkus, value, onChange,
}: {
  u: UnmatchedChannelProduct;
  allSkus: Array<{ sku: string; name: string }>;
  value: string;
  onChange: (sku: string) => void;
}) {
  const candSkus = new Set(u.candidates.map((c) => c.sku));
  const others = allSkus.filter((s) => !candSkus.has(s.sku));
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs flex-wrap ${value ? "bg-violet-100/60 dark:bg-violet-900/20" : "bg-white dark:bg-zinc-900"}`}>
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 shrink-0">
        {PRICING_CHANNEL_LABEL[u.channel]}
      </span>
      <span className="font-medium text-zinc-800 dark:text-zinc-100 truncate max-w-[240px]">{u.name}</span>
      <span className="text-zinc-400 tabular-nums">{krw(u.discount)}</span>
      <div className="flex-1" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900 max-w-[280px]"
      >
        <option value="">SKU 선택… (비우면 제외)</option>
        {u.candidates.length > 0 && (
          <optgroup label="추천 후보">
            {u.candidates.map((c) => (
              <option key={c.sku} value={c.sku}>
                {c.name} ({c.sku}) · {Math.round(c.score * 100)}%
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="전체 SKU">
          {others.map((s) => (
            <option key={s.sku} value={s.sku}>
              {s.name} ({s.sku})
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
