"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Settings as SettingsIcon, X, Plus, Trash2, Check } from "lucide-react";
import type { DailyData, DailyCost } from "@/lib/cafe24Data";
import type { ProfitSettings, FixedCost } from "@/lib/profitSettings";
import { DEFAULT_SETTINGS } from "@/lib/profitSettings";

export interface ProfitChannel {
  id: string;
  name: string;
  color: string;
  daily: DailyData[];
  cogs?: DailyCost[];
}

interface Props {
  channels: ProfitChannel[];
  unmatchedSkus?: string[];
  brand?: string; // 메타 광고 계정 브랜드 필터링용
}

type Preset = "today" | "7d" | "30d" | "60d" | "custom";

function todayStr() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function daysAgoStr(n: number) {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtKrw(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function fmtKrwSigned(n: number): string {
  if (n === 0) return fmtKrw(0);
  if (n < 0) return `-₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
  return fmtKrw(n);
}

function fmtDate(date: string): string {
  const d = new Date(date + "T00:00:00+09:00");
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${dow})`;
}

function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T00:00:00+09:00").getTime();
  const e = new Date(end + "T00:00:00+09:00").getTime();
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

/**
 * 재무 카테고리 → P&L 고정비 자동 반영 대상.
 * 제외: 광고비(메타에서 자동) / 매입(COGS에서 자동) / 카드결제(통장에 찍힌 카드대금 = 카드 사용내역과 중복) /
 *      매출·송금·기타(비용 아님 또는 불명확)
 */
const AUTO_FIXED_CATEGORIES = [
  "임대료", "인건비", "통신비", "소프트웨어",
  "세금", "수수료", "택배비", "식비", "교통/연료",
] as const;

export default function ProfitDashboard({ channels, unmatchedSkus, brand }: Props) {
  const [preset, setPreset] = useState<Preset>("30d");
  const [customStart, setCustomStart] = useState<string>(daysAgoStr(30));
  const [customEnd, setCustomEnd] = useState<string>(todayStr());
  const [settings, setSettings] = useState<ProfitSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<string>("all");
  const [metaDaily, setMetaDaily] = useState<{ date: string; spend: number }[]>([]);
  const [metaLinked, setMetaLinked] = useState(false);
  const [wconceptAdsDaily, setWconceptAdsDaily] = useState<{ date: string; spend: number }[]>([]);
  const [categorySpend, setCategorySpend] = useState<Record<string, { amount: number; count: number }>>({});

  // 설정 불러오기
  useEffect(() => {
    fetch("/api/profit/settings")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setSettings(j.settings);
      })
      .catch(() => {/* 기본값 사용 */});
  }, []);

  // 메타 광고비 불러오기 (지난 60일, 브랜드 필터)
  useEffect(() => {
    const params = new URLSearchParams({ days: "60" });
    if (brand) params.set("brand", brand);
    fetch(`/api/profit/meta-spend?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setMetaDaily(j.daily ?? []);
          setMetaLinked(true);
        } else {
          setMetaLinked(false);
        }
      })
      .catch(() => setMetaLinked(false));
  }, [brand]);

  // W컨셉 플랫폼 내 광고비 불러오기 (CSV 업로드 누적분)
  useEffect(() => {
    fetch("/api/finance/ad-spend?source=wconcept&days=365")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setWconceptAdsDaily(j.daily ?? []);
      })
      .catch(() => { /* 미업로드 시 0 처리 */ });
  }, []);

  const saveSettings = useCallback(async (patch: Partial<ProfitSettings>) => {
    const res = await fetch("/api/profit/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const j = await res.json();
    if (j.ok) setSettings(j.settings);
  }, []);

  const { startDate, endDate } = useMemo(() => {
    const t = todayStr();
    if (preset === "today") return { startDate: t, endDate: t };
    if (preset === "7d") return { startDate: daysAgoStr(6), endDate: t };
    if (preset === "30d") return { startDate: daysAgoStr(29), endDate: t };
    if (preset === "60d") return { startDate: daysAgoStr(59), endDate: t };
    return { startDate: customStart, endDate: customEnd };
  }, [preset, customStart, customEnd]);

  // 재무 카테고리별 출금 합계 (P&L 자동 고정비 연동)
  useEffect(() => {
    const params = new URLSearchParams({ since: startDate, until: endDate });
    fetch(`/api/profit/category-spend?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setCategorySpend(j.perCategory ?? {});
      })
      .catch(() => { /* 재무 데이터 없으면 0 처리 */ });
  }, [startDate, endDate]);

  // 채널 필터링 (전체 또는 특정 채널만)
  const visibleChannels = useMemo(
    () =>
      activeChannel === "all"
        ? channels
        : channels.filter((c) => c.id === activeChannel),
    [channels, activeChannel]
  );

  // 고정비도 채널별 보기에서는 매출 비중만큼 안분 (전체에서 차지하는 매출 비율로)
  // 단순화를 위해 일단 전체 매출 대비 그 채널 매출 비율로 안분
  const totalRevAllChannels = useMemo(() => {
    let s = 0;
    for (const ch of channels) {
      for (const d of ch.daily) {
        if (d.date >= startDate && d.date <= endDate) s += d.revenue;
      }
    }
    return s;
  }, [channels, startDate, endDate]);

  // ── 계산 ───────────────────────────────────────────────────────────────
  const calc = useMemo(() => {
    // 채널별 매출/주문 합산 (기간 내) — visible만
    const perChannel: Record<string, { revenue: number; orders: number; fee: number }> = {};
    let totalRev = 0;
    let totalOrders = 0;

    for (const ch of visibleChannels) {
      let chRev = 0;
      let chOrd = 0;
      for (const d of ch.daily) {
        if (d.date >= startDate && d.date <= endDate) {
          chRev += d.revenue;
          chOrd += d.orders;
        }
      }
      const feeRate = settings.channelFees[ch.id] ?? 0;
      const fee = (chRev * feeRate) / 100;
      perChannel[ch.id] = { revenue: chRev, orders: chOrd, fee };
      totalRev += chRev;
      totalOrders += chOrd;
    }

    // 부가세 (매출의 vatRate/(100+vatRate))
    const vatLiability = (totalRev * settings.vatRate) / (100 + settings.vatRate);
    const revenueExVat = totalRev - vatLiability;

    // 채널 수수료 합
    const totalFees = Object.values(perChannel).reduce((s, c) => s + c.fee, 0);

    // 택배비 = 합배송 그룹 단위 × 단가 (없으면 주문수 fallback)
    let totalShipments = 0;
    for (const ch of visibleChannels) {
      for (const d of ch.daily) {
        if (d.date >= startDate && d.date <= endDate) {
          totalShipments += d.shipments ?? d.orders;
        }
      }
    }
    const shipping = totalShipments * settings.shippingPerOrder;

    // 매입원가 (COGS) — 채널의 cogs 배열에서 기간 내 합
    let totalCogs = 0;
    for (const ch of visibleChannels) {
      for (const c of ch.cogs ?? []) {
        if (c.date >= startDate && c.date <= endDate) totalCogs += c.cost;
      }
    }

    // 메타 광고비 — 기간 내 합 × 채널 안분 비율
    // (메타는 외부 트래픽 → 모든 채널로 분산되므로 매출 비중대로 안분)
    let totalMetaSpend = 0;
    for (const m of metaDaily) {
      if (m.date >= startDate && m.date <= endDate) totalMetaSpend += m.spend;
    }
    const totalMetaSpendForChannel =
      activeChannel === "all"
        ? totalMetaSpend
        : totalRevAllChannels > 0
          ? totalMetaSpend * (totalRev / totalRevAllChannels)
          : 0;

    // W컨셉 플랫폼 내 광고비 — W컨셉 채널 매출에만 귀속 (다른 채널엔 영향 없음)
    let totalWconceptAds = 0;
    for (const w of wconceptAdsDaily) {
      if (w.date >= startDate && w.date <= endDate) totalWconceptAds += w.spend;
    }
    const wconceptVisible = visibleChannels.some((c) => c.id === "wconcept");
    const totalWconceptAdsForChannel = wconceptVisible ? totalWconceptAds : 0;

    // 매출총이익 = 순매출 - 수수료 - 택배비 - 매입원가 - 광고비(메타+W컨셉)
    const grossProfit =
      revenueExVat - totalFees - shipping - totalCogs
      - totalMetaSpendForChannel - totalWconceptAdsForChannel;

    // 고정비 (월 기준 → 일별로 안분 → 기간 일수만큼)
    // 특정 채널 보기일 때는 그 채널의 매출 비중만큼만 안분
    const days = daysBetween(startDate, endDate);
    const monthlyFixedTotal = settings.fixedCosts.reduce((s, c) => s + c.monthly, 0);
    const fullPeriodFixed = (monthlyFixedTotal / 30) * days;
    const channelShare =
      activeChannel === "all"
        ? 1
        : totalRevAllChannels > 0
          ? totalRev / totalRevAllChannels
          : 0;
    const fixedAllocated = fullPeriodFixed * channelShare;

    // 재무 자동 고정비 — 기간 내 실제 발생액 (월 환산 안 함, 그대로 안분 적용)
    const autoFixedItems = AUTO_FIXED_CATEGORIES
      .map((cat) => ({ cat, amount: categorySpend[cat]?.amount ?? 0, count: categorySpend[cat]?.count ?? 0 }))
      .filter((x) => x.amount > 0);
    const autoFixedTotal = autoFixedItems.reduce((s, x) => s + x.amount, 0);
    const autoFixedAllocated = autoFixedTotal * channelShare;

    const operatingProfit = grossProfit - fixedAllocated - autoFixedAllocated;
    const margin = totalRev > 0 ? (operatingProfit / totalRev) * 100 : 0;

    // 일별 행 (표 표시용) — visible 채널만
    const dateSet = new Set<string>();
    for (const ch of visibleChannels) {
      for (const d of ch.daily) {
        if (d.date >= startDate && d.date <= endDate) dateSet.add(d.date);
      }
    }
    const dates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

    // 채널 안분 비율 (광고비를 채널별로 나누는 데 사용) — 위에서 정의된 값 사용
    const _channelShareForRows = activeChannel === "all" ? 1 : (totalRevAllChannels > 0 ? totalRev / totalRevAllChannels : 0);

    const dailyRows = dates.map((date) => {
      let dayRev = 0;
      let dayOrders = 0;
      let dayShipments = 0;
      let dayFee = 0;
      let dayCogs = 0;
      for (const ch of visibleChannels) {
        const found = ch.daily.find((d) => d.date === date);
        const rev = found?.revenue ?? 0;
        const ord = found?.orders ?? 0;
        const ship = found?.shipments ?? ord;
        const feeRate = settings.channelFees[ch.id] ?? 0;
        dayRev += rev;
        dayOrders += ord;
        dayShipments += ship;
        dayFee += (rev * feeRate) / 100;
        const cogsEntry = ch.cogs?.find((c) => c.date === date);
        if (cogsEntry) dayCogs += cogsEntry.cost;
      }
      const dayVat = (dayRev * settings.vatRate) / (100 + settings.vatRate);
      const dayShipping = dayShipments * settings.shippingPerOrder;
      const metaEntry = metaDaily.find((m) => m.date === date);
      const dayMeta = (metaEntry?.spend ?? 0) * _channelShareForRows;
      const wconceptEntry = wconceptAdsDaily.find((w) => w.date === date);
      const dayWconceptAds = wconceptVisible ? (wconceptEntry?.spend ?? 0) : 0;
      const dayNet = dayRev - dayVat - dayFee - dayShipping - dayCogs - dayMeta - dayWconceptAds;
      return { date, dayRev, dayOrders, dayShipments, dayFee, dayVat, dayShipping, dayCogs, dayMeta, dayWconceptAds, dayNet };
    });

    return {
      perChannel,
      totalRev,
      totalOrders,
      totalShipments,
      vatLiability,
      revenueExVat,
      totalFees,
      shipping,
      totalCogs,
      totalMetaSpend,
      totalMetaSpendForChannel,
      totalWconceptAds,
      totalWconceptAdsForChannel,
      wconceptVisible,
      grossProfit,
      monthlyFixedTotal,
      fixedAllocated,
      autoFixedItems,
      autoFixedTotal,
      autoFixedAllocated,
      channelShare,
      operatingProfit,
      margin,
      days,
      dailyRows,
    };
  }, [visibleChannels, settings, startDate, endDate, activeChannel, totalRevAllChannels, metaDaily, wconceptAdsDaily, categorySpend]);

  return (
    <section className="space-y-4 min-w-0">
      {/* 헤더 + 기간 선택 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-3 sm:p-6 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <Calendar size={18} className="text-violet-600" />
          <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
            손익 분석 (P&amp;L)
          </h2>
          <span className="text-xs text-zinc-500 ml-auto hidden sm:inline">
            {startDate} ~ {endDate} · {calc.days}일
          </span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="ml-auto sm:ml-0 p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
            title="비용 설정"
          >
            <SettingsIcon size={16} />
          </button>
        </div>

        {/* 기간 선택 — 모바일에선 가로 스크롤 */}
        <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0">
          {(
            [
              { k: "today" as const, label: "오늘" },
              { k: "7d" as const, label: "7일" },
              { k: "30d" as const, label: "30일" },
              { k: "60d" as const, label: "60일" },
              { k: "custom" as const, label: "직접" },
            ]
          ).map(({ k, label }) => (
            <button
              key={k}
              onClick={() => setPreset(k)}
              className={`shrink-0 px-3 h-8 rounded-full text-xs font-medium transition ${
                preset === k
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2 h-8 rounded-md text-xs border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
              <span className="text-xs text-zinc-400">~</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2 h-8 rounded-md text-xs border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950"
              />
            </div>
          )}
        </div>

        {/* 채널 토글 — 모바일에선 가로 스크롤 */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 overflow-x-auto -mx-1 px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0">
          <span className="shrink-0 text-[10px] font-bold text-zinc-500 uppercase tracking-wider mr-1">
            채널
          </span>
          <button
            onClick={() => setActiveChannel("all")}
            className={`shrink-0 px-3 h-8 rounded-full text-xs font-medium transition ${
              activeChannel === "all"
                ? "bg-violet-600 text-white"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            전체 합산
          </button>
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={`shrink-0 px-3 h-8 rounded-full text-xs font-medium transition flex items-center gap-1.5 ${
                activeChannel === ch.id
                  ? "text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
              style={
                activeChannel === ch.id ? { backgroundColor: ch.color } : undefined
              }
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: ch.color }}
              />
              {ch.name}
            </button>
          ))}
        </div>
      </div>

      {/* P&L 요약 카드 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-3 sm:p-6 space-y-3 min-w-0 overflow-hidden">
        {/* 매출 */}
        <PnlSection title="매출 (VAT 포함)">
          {channels.map((ch) => {
            const pc = calc.perChannel[ch.id];
            if (!pc || pc.revenue === 0) return null;
            return (
              <PnlRow
                key={ch.id}
                label={`${ch.name}`}
                sub={`주문 ${pc.orders.toLocaleString("ko-KR")}건`}
                amount={pc.revenue}
                color={ch.color}
              />
            );
          })}
          <PnlRow label="총 매출" amount={calc.totalRev} bold />
        </PnlSection>

        {/* 변동비 */}
        <PnlSection title="변동비 (매출 연동)">
          <PnlRow
            label="부가세"
            sub={`매출의 ${settings.vatRate}/(100+${settings.vatRate})`}
            amount={-calc.vatLiability}
          />
          {channels.map((ch) => {
            const pc = calc.perChannel[ch.id];
            if (!pc || pc.fee === 0) return null;
            const rate = settings.channelFees[ch.id] ?? 0;
            return (
              <PnlRow
                key={ch.id}
                label={`${ch.name} 수수료`}
                sub={`${rate}%`}
                amount={-pc.fee}
              />
            );
          })}
          <PnlRow
            label="택배비"
            sub={
              calc.totalShipments < calc.totalOrders
                ? `합배송 ${calc.totalShipments.toLocaleString("ko-KR")}건 × ${fmtKrw(settings.shippingPerOrder)} (주문 ${calc.totalOrders}건 → 합배송 후 ${calc.totalShipments}건)`
                : `${calc.totalShipments.toLocaleString("ko-KR")}건 × ${fmtKrw(settings.shippingPerOrder)}`
            }
            amount={-calc.shipping}
          />
          <PnlRow
            label="매입원가 (COGS)"
            sub={
              calc.totalCogs === 0
                ? "원가 미설정 — 재고 페이지에서 입력"
                : "주문 상품의 매입 단가 합산"
            }
            amount={-calc.totalCogs}
          />
          <PnlRow
            label="메타 광고비"
            sub={
              !metaLinked
                ? "Meta 미연결 — 고정비에 수동 입력 가능"
                : activeChannel === "all"
                  ? "Meta API 자동 동기화 (전체 광고 계정 합산)"
                  : `Meta API · 채널 매출 비중 ${(calc.channelShare * 100).toFixed(1)}%`
            }
            amount={-calc.totalMetaSpendForChannel}
          />
          {(calc.totalWconceptAds > 0 || calc.wconceptVisible) && (
            <PnlRow
              label="W컨셉 광고비"
              sub={
                calc.totalWconceptAds === 0
                  ? "재무 페이지에서 W컨셉 일별 리포트 CSV 업로드"
                  : calc.wconceptVisible
                    ? "W컨셉 플랫폼 내 광고 (W컨셉 채널 귀속)"
                    : "다른 채널 보기 — W컨셉 광고비는 W컨셉에만 귀속"
              }
              amount={-calc.totalWconceptAdsForChannel}
            />
          )}
          <PnlRow label="매출총이익" amount={calc.grossProfit} bold accent />
        </PnlSection>

        {unmatchedSkus && unmatchedSkus.length > 0 && (
          <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            ⚠ 원가 미설정 SKU {unmatchedSkus.length}개 — 재고 페이지에서 매입 단가를 입력하면 영업이익이 더 정확해집니다.
          </div>
        )}

        {/* 고정비 */}
        <PnlSection
          title={
            activeChannel === "all"
              ? "고정비 / 운영비"
              : `고정비 / 운영비 (매출 비중 ${(calc.channelShare * 100).toFixed(1)}%)`
          }
        >
          {/* 재무 자동 연동 (재무 페이지 거래내역 카테고리별 합계) */}
          {calc.autoFixedItems.length > 0 && (
            <>
              {calc.autoFixedItems.map((it) => (
                <PnlRow
                  key={`auto-${it.cat}`}
                  label={`${it.cat}`}
                  sub={`재무 자동 · ${calc.days}일 ${it.count}건${activeChannel !== "all" ? ` × 비중 ${(calc.channelShare * 100).toFixed(1)}%` : ""}`}
                  amount={-it.amount * calc.channelShare}
                />
              ))}
              <PnlRow
                label="재무 자동 합"
                sub={`기간 합계 ${fmtKrw(calc.autoFixedTotal)}${activeChannel !== "all" ? " (안분 전)" : ""}`}
                amount={-calc.autoFixedAllocated}
              />
            </>
          )}

          {/* 사용자 수동 고정비 (월 단위, 일별 안분) */}
          {settings.fixedCosts.length === 0 && calc.autoFixedItems.length === 0 ? (
            <div className="px-4 py-3 text-xs text-zinc-400 text-center">
              재무 페이지에 거래내역을 업로드하면 임대료/통신비/소프트웨어 등이 자동 반영됩니다.
              월 정기 고정비는 우상단 ⚙ 아이콘으로 직접 추가할 수 있어요.
            </div>
          ) : (
            settings.fixedCosts.map((c) => {
              const allocated = (c.monthly / 30) * calc.days * calc.channelShare;
              return (
                <PnlRow
                  key={c.id}
                  label={c.name}
                  sub={`수동 · 월 ${fmtKrw(c.monthly)} → ${calc.days}일 안분`}
                  amount={-allocated}
                />
              );
            })
          )}
          {settings.fixedCosts.length > 0 && (
            <PnlRow
              label="수동 고정비 합"
              sub={`월 합계 ${fmtKrw(calc.monthlyFixedTotal)}`}
              amount={-calc.fixedAllocated}
            />
          )}
        </PnlSection>

        {/* 결과 */}
        <div className="border-t-2 border-zinc-200 dark:border-zinc-700 pt-3 mt-3">
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-900/20 dark:to-fuchsia-900/20 rounded-xl">
            <div>
              <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                영업이익 (Net Profit)
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5">
                매출 − 변동비 − 고정비/운영비
              </div>
            </div>
            <div className="text-right">
              <div
                className={`text-xl sm:text-2xl font-bold tabular-nums ${
                  calc.operatingProfit >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {fmtKrwSigned(calc.operatingProfit)}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">
                영업이익률 {calc.margin.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 일별 표 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-0">
        <div className="px-4 sm:px-6 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            일별 상세
          </h3>
        </div>

        {/* 모바일: 카드 리스트 (sm 미만) */}
        <div className="sm:hidden divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {calc.dailyRows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-zinc-400">
              해당 기간의 매출 데이터가 없습니다
            </div>
          ) : (
            calc.dailyRows.map((r) => {
              const totalCost = r.dayVat + r.dayFee + r.dayShipping + r.dayCogs + r.dayMeta + r.dayWconceptAds;
              return (
                <div key={r.date} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      {fmtDate(r.date)}
                    </div>
                    <div
                      className={`text-base font-bold tabular-nums ${
                        r.dayNet >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {fmtKrwSigned(r.dayNet)}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-500 tabular-nums">
                    <div className="flex justify-between">
                      <span>매출</span>
                      <span className="text-zinc-700 dark:text-zinc-300 font-medium">{fmtKrw(r.dayRev)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>비용 합</span>
                      <span>-{fmtKrw(totalCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>주문</span>
                      <span>{r.dayOrders}건</span>
                    </div>
                    <div className="flex justify-between">
                      <span>광고비</span>
                      <span>{(r.dayMeta + r.dayWconceptAds) > 0 ? `-${fmtKrw(r.dayMeta + r.dayWconceptAds)}` : "—"}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 데스크탑: 기존 표 (sm 이상) */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-950/50 border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap sticky left-0 bg-zinc-50 dark:bg-zinc-950/50 z-10">
                  날짜
                </th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap">
                  매출
                </th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap">
                  부가세
                </th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap">
                  수수료
                </th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap">
                  택배비
                </th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap">
                  매입원가
                </th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap">
                  광고비
                </th>
                <th className="px-4 py-2.5 text-right font-bold text-zinc-700 dark:text-zinc-300 text-xs whitespace-nowrap">
                  순이익
                </th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-600 dark:text-zinc-400 text-xs whitespace-nowrap">
                  주문
                </th>
              </tr>
            </thead>
            <tbody>
              {calc.dailyRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-zinc-400">
                    해당 기간의 매출 데이터가 없습니다
                  </td>
                </tr>
              ) : (
                calc.dailyRows.map((r) => (
                  <tr
                    key={r.date}
                    className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                  >
                    <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-900 z-10">
                      {fmtDate(r.date)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-700 dark:text-zinc-300 tabular-nums whitespace-nowrap">
                      {fmtKrw(r.dayRev)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                      -{fmtKrw(r.dayVat)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                      -{fmtKrw(r.dayFee)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                      -{fmtKrw(r.dayShipping)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                      {r.dayCogs > 0 ? `-${fmtKrw(r.dayCogs)}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                      {(r.dayMeta + r.dayWconceptAds) > 0
                        ? `-${fmtKrw(r.dayMeta + r.dayWconceptAds)}`
                        : "—"}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${
                        r.dayNet >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {fmtKrwSigned(r.dayNet)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                      {r.dayOrders}건
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 설정 드로어 */}
      {settingsOpen && (
        <SettingsDrawer
          settings={settings}
          channels={channels}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </section>
  );
}

function PnlSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5 px-1">
        {title}
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60 border border-zinc-100 dark:border-zinc-800 rounded-xl overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function PnlRow({
  label,
  sub,
  amount,
  bold = false,
  accent = false,
  color,
}: {
  label: string;
  sub?: string;
  amount: number;
  bold?: boolean;
  accent?: boolean;
  color?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 ${
        bold
          ? "bg-zinc-50 dark:bg-zinc-950/50 font-bold"
          : "bg-white dark:bg-zinc-900"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {color && (
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={`text-sm ${
              bold
                ? "text-zinc-900 dark:text-zinc-100"
                : "text-zinc-700 dark:text-zinc-300"
            }`}
          >
            {label}
          </div>
          {sub && (
            <div className="text-[11px] sm:text-[10px] text-zinc-400 mt-0.5 break-keep">{sub}</div>
          )}
        </div>
      </div>
      <div
        className={`tabular-nums whitespace-nowrap shrink-0 ${
          bold ? "text-base" : "text-sm"
        } ${
          accent
            ? "text-emerald-600 dark:text-emerald-400 font-bold"
            : amount < 0
              ? "text-zinc-500"
              : "text-zinc-900 dark:text-zinc-100"
        }`}
      >
        {fmtKrwSigned(amount)}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// 설정 드로어
// ────────────────────────────────────────────────────────────────────

function SettingsDrawer({
  settings,
  channels,
  onSave,
  onClose,
}: {
  settings: ProfitSettings;
  channels: ProfitChannel[];
  onSave: (patch: Partial<ProfitSettings>) => Promise<void>;
  onClose: () => void;
}) {
  const [draftFees, setDraftFees] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(settings.channelFees).map(([k, v]) => [k, String(v)])
    )
  );
  const [draftShipping, setDraftShipping] = useState(String(settings.shippingPerOrder));
  const [draftVat, setDraftVat] = useState(String(settings.vatRate));
  const [draftFixed, setDraftFixed] = useState<FixedCost[]>(settings.fixedCosts);
  const [saving, setSaving] = useState(false);

  const addFixedCost = () => {
    setDraftFixed((arr) => [
      ...arr,
      { id: crypto.randomUUID(), name: "", monthly: 0 },
    ]);
  };
  const updateFixedCost = (id: string, patch: Partial<FixedCost>) => {
    setDraftFixed((arr) => arr.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const removeFixedCost = (id: string) => {
    setDraftFixed((arr) => arr.filter((c) => c.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const channelFees = Object.fromEntries(
        Object.entries(draftFees).map(([k, v]) => [k, parseFloat(v) || 0])
      );
      await onSave({
        channelFees,
        fixedCosts: draftFixed.filter((c) => c.name.trim()),
        shippingPerOrder: parseInt(draftShipping, 10) || 0,
        vatRate: parseFloat(draftVat) || 0,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 flex flex-col shadow-2xl animate-in slide-in-from-right">
        <div className="flex items-center justify-between px-5 h-14 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            비용 설정
          </h3>
          <button
            onClick={onClose}
            className="p-2 -mr-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={18} className="text-zinc-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* 채널별 수수료 */}
          <div>
            <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
              채널별 수수료율 (%)
            </div>
            <div className="space-y-1.5">
              {channels.map((ch) => (
                <div key={ch.id} className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: ch.color }}
                  />
                  <label className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {ch.name}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={draftFees[ch.id] ?? "0"}
                    onChange={(e) =>
                      setDraftFees({ ...draftFees, [ch.id]: e.target.value })
                    }
                    className="w-24 px-2 h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-right tabular-nums"
                  />
                  <span className="text-xs text-zinc-400 w-3">%</span>
                </div>
              ))}
            </div>
          </div>

          {/* 부가세 */}
          <div>
            <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
              부가세율 (%)
            </div>
            <input
              type="number"
              step="0.1"
              value={draftVat}
              onChange={(e) => setDraftVat(e.target.value)}
              className="w-full px-3 h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm tabular-nums"
            />
            <div className="text-[10px] text-zinc-400 mt-1">
              일반 사업자 = 10. 매출 부가세는 매출 × {draftVat}/(100+{draftVat}) 로 자동 계산.
            </div>
          </div>

          {/* 택배 단가 */}
          <div>
            <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
              택배 단가 (주문 1건당, 원)
            </div>
            <input
              type="number"
              value={draftShipping}
              onChange={(e) => setDraftShipping(e.target.value)}
              className="w-full px-3 h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm tabular-nums"
            />
          </div>

          {/* 고정비 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                월 고정비 항목
              </div>
              <button
                onClick={addFixedCost}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-xs font-medium bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20"
              >
                <Plus size={12} />
                항목 추가
              </button>
            </div>
            {draftFixed.length === 0 ? (
              <div className="text-xs text-zinc-400 text-center py-6 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-lg">
                예: 사무실 임대료, 메타 광고비, Anthropic API 등
              </div>
            ) : (
              <div className="space-y-1.5">
                {draftFixed.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="항목명"
                      value={c.name}
                      onChange={(e) => updateFixedCost(c.id, { name: e.target.value })}
                      className="flex-1 px-2 h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm"
                    />
                    <input
                      type="number"
                      placeholder="0"
                      value={c.monthly === 0 ? "" : c.monthly}
                      onChange={(e) =>
                        updateFixedCost(c.id, {
                          monthly: parseInt(e.target.value, 10) || 0,
                        })
                      }
                      className="w-32 px-2 h-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-right tabular-nums"
                    />
                    <button
                      onClick={() => removeFixedCost(c.id)}
                      className="p-1.5 rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 h-10 rounded-lg text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 h-10 rounded-lg text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Check size={14} />
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
