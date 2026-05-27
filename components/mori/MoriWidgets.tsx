"use client";

import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { X } from "lucide-react";
import type { MoriWidget, ChartWidget, CardsWidget } from "@/lib/mori/widgetTypes";

/**
 * 모리가 Tool Use로 띄운 위젯 패널.
 * 구체(얼굴)는 유지한 채, 상단 영역 우측에 반투명 패널로 슬라이드.
 */
export default function MoriWidgets({
  widgets,
  onClear,
}: {
  widgets: MoriWidget[];
  onClear: () => void;
}) {
  if (widgets.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute right-3 top-3 bottom-3 z-10 flex w-[min(420px,46vw)] flex-col gap-3 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1320]/80 p-3 backdrop-blur-md">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold tracking-wide text-[#9fb0c8]">모리가 띄운 것</span>
        <button
          onClick={onClear}
          className="rounded-full p-1 text-[#7c8aa0] transition hover:bg-white/10 hover:text-white"
          title="위젯 비우기"
        >
          <X size={14} />
        </button>
      </div>
      {widgets.map((w) => (w.kind === "chart" ? <Chart key={w.id} w={w} /> : <Cards key={w.id} w={w} />))}
    </div>
  );
}

const fmtTick = (v: number, unit: string) => {
  if (unit === "원") return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : `${Math.round(v / 1000)}k`;
  return String(v);
};

function Chart({ w }: { w: ChartWidget }) {
  const Wrapper = w.chartType === "bar" ? BarChart : LineChart;
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <p className="mb-2 text-xs font-medium text-[#cdd7e6]">{w.title}</p>
      <ResponsiveContainer width="100%" height={170}>
        <Wrapper data={w.data} margin={{ top: 4, right: 6, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7a93" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: "#6b7a93" }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtTick(v, w.unit)} width={36} />
          <Tooltip
            contentStyle={{ background: "#11192a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12, color: "#E8ECF0" }}
            formatter={(v: any) => [`${Number(v).toLocaleString("ko-KR")}${w.unit}`, ""]}
          />
          {w.chartType === "bar" ? (
            <Bar dataKey="value" fill="#9fb0c8" radius={[3, 3, 0, 0]} maxBarSize={22} />
          ) : (
            <Line type="monotone" dataKey="value" stroke="#F4E4C1" strokeWidth={2} dot={false} />
          )}
        </Wrapper>
      </ResponsiveContainer>
    </div>
  );
}

const toneColor = (t?: string) =>
  t === "good" ? "text-emerald-300" : t === "warn" ? "text-amber-300" : "text-[#E8ECF0]";

function Cards({ w }: { w: CardsWidget }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
      {w.title && <p className="mb-2 text-xs font-medium text-[#cdd7e6]">{w.title}</p>}
      <div className="grid grid-cols-2 gap-2">
        {w.cards.map((c, i) => (
          <div key={i} className="rounded-lg bg-white/[0.04] px-3 py-2">
            <p className="text-[10px] text-[#7c8aa0]">{c.label}</p>
            <p className={`text-base font-semibold ${toneColor(c.tone)}`}>{c.value}</p>
            {c.sub && <p className="text-[10px] text-[#6b7a93]">{c.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
