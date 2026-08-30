"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp } from "lucide-react";
import type { Brand } from "@/lib/multiChannelData";

type Granularity = "day" | "week" | "month";

interface Point { date: string; revenue: number }

interface Props {
  brand: Brand;
  brandLabel: string;
  /** 상단 판매채널 탭과 연동. "all" 이면 전체 합계. */
  channel?: string;
  channelLabel?: string;
  /** 채널별 고유색 — 어느 채널을 보고 있는지 그래프 색으로도 알 수 있게 */
  channelColor?: string;
}

const ACCENT: Record<Brand, string> = {
  paulvice: "#7c3aed",
  harriot:  "#b45309",
};

function fmtKRWShort(n: number): string {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000_000)  return (n / 10_000_000).toFixed(1)  + "천만";
  if (n >= 10_000)      return (n / 10_000).toFixed(0)      + "만";
  return n.toLocaleString("ko-KR");
}

function fmtKRWFull(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

/** YYYY-MM-DD 빼기 N일 */
function subtractDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}
function subtractMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}
function toDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** granularity 별 기본 기간(end 는 오늘 KST) */
function defaultRange(g: Granularity): { from: string; to: string } {
  // KST 자정 기준 today
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()));
  const to = toDateStr(today);
  let from: string;
  if (g === "day")        from = toDateStr(subtractMonths(today, 1));     // 1개월
  else if (g === "week")  from = toDateStr(subtractMonths(today, 6));     // 6개월
  else                    from = toDateStr(subtractMonths(today, 12));    // 1년
  return { from, to };
}

/** XAxis tick 포맷터 */
function formatTick(date: string, g: Granularity): string {
  const [y, m, d] = date.split("-").map(Number);
  if (g === "month") return `${m}월`;
  if (g === "week")  return `${m}/${d}`;
  return `${m}/${d}`;
}

/** Tooltip 라벨 포맷 */
function formatLabel(date: string, g: Granularity): string {
  if (g === "month") return date.slice(0, 7);
  if (g === "week")  return `${date} 주`;
  return date;
}

export default function RevenueTrendWidget({ brand, brandLabel, channel = "all", channelLabel, channelColor }: Props) {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [range, setRange] = useState<{ from: string; to: string }>(() => defaultRange("day"));
  const [touched, setTouched] = useState(false); // 사용자가 수동 변경했는지
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // granularity 바뀔 때 — 사용자가 수동 변경 안 했으면 기본 기간으로 리셋
  const switchGranularity = (g: Granularity) => {
    setGranularity(g);
    if (!touched) setRange(defaultRange(g));
  };

  const onRangeEdit = (patch: Partial<{ from: string; to: string }>) => {
    setRange((r) => ({ ...r, ...patch }));
    setTouched(true);
  };

  const resetRange = () => {
    setRange(defaultRange(granularity));
    setTouched(false);
  };

  // brand 변경 시 기본 기간으로 (touched 도 리셋)
  useEffect(() => {
    setRange(defaultRange(granularity));
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand]);

  // fetch
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      brand, granularity, from: range.from, to: range.to, channel,
    });
    fetch(`/api/revenue-trend?${qs.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (!j.ok) { setError(j.error ?? "조회 실패"); setPoints([]); return; }
        setPoints(j.points ?? []);
      })
      .catch((e) => { if (!cancel) setError(String(e)); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [brand, granularity, range.from, range.to, channel]);

  const total = useMemo(() => points.reduce((s, p) => s + p.revenue, 0), [points]);
  // 채널을 고르면 그 채널색으로 — 브랜드색만 쓰면 탭을 바꿔도 화면이 같아 보인다.
  const accent = (channel !== "all" && channelColor) || ACCENT[brand];

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden flex flex-col h-full">
      {/* 헤더 */}
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
        >
          <TrendingUp size={13} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex-1 truncate">
          매출 추이
          {channel !== "all" && channelLabel && (
            <span className="ml-1.5 text-[11px] font-medium text-zinc-500">· {channelLabel}</span>
          )}
        </h3>
        <span className="hidden sm:inline text-[10px] font-medium text-zinc-400 shrink-0">{brandLabel}</span>
      </div>

      <div className="px-5 py-3 flex flex-col gap-3 flex-1 min-h-0">
        {/* 토글 + 기간 */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
            {(["day", "week", "month"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => switchGranularity(g)}
                className={`px-2.5 h-7 text-[11px] font-semibold rounded-md transition ${
                  granularity === g
                    ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {g === "day" ? "일별" : g === "week" ? "주별" : "월별"}
              </button>
            ))}
          </div>

          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => onRangeEdit({ from: e.target.value })}
            className="text-[11px] h-7 px-2 rounded-md bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 tabular-nums"
          />
          <span className="text-[11px] text-zinc-400">→</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => onRangeEdit({ to: e.target.value })}
            className="text-[11px] h-7 px-2 rounded-md bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 tabular-nums"
          />
          {touched && (
            <button
              onClick={resetRange}
              className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 underline underline-offset-2"
              title="기본 기간으로 리셋"
            >
              기본
            </button>
          )}

          <span className="ml-auto text-[11px] text-zinc-500 tabular-nums">
            합계 <span className="font-semibold text-zinc-800 dark:text-zinc-100">{fmtKRWShort(total)}원</span>
          </span>
        </div>

        {/* 차트 */}
        <div className="flex-1 min-h-[160px]">
          {loading ? (
            <div className="h-full flex items-center justify-center text-xs text-zinc-400">로딩 중…</div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-xs text-rose-500">{error}</div>
          ) : points.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-zinc-400">
              표시할 데이터가 없습니다 — 매일 새벽에 누적되며 기간을 넓혀 보세요
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id={`revLine-${brand}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"  stopColor={accent} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={accent} stopOpacity={1}  />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatTick(v, granularity)}
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => fmtKRWShort(v)}
                  width={48}
                />
                <Tooltip
                  cursor={{ stroke: accent, strokeOpacity: 0.2 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const p = payload[0]!.payload as Point;
                    return (
                      <div className="bg-zinc-900 text-white rounded-lg px-3 py-2 shadow-xl text-xs">
                        <div className="font-semibold mb-0.5">{formatLabel(p.date, granularity)}</div>
                        <div className="tabular-nums" style={{ color: accent }}>
                          {fmtKRWFull(p.revenue)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={`url(#revLine-${brand})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: accent }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
