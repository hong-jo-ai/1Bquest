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
import { useState } from "react";
import { X, Send, Check, Loader2 } from "lucide-react";
import type { MoriWidget, ChartWidget, CardsWidget, ConfirmWidget } from "@/lib/mori/widgetTypes";

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
      {widgets.map((w) =>
        w.kind === "chart" ? (
          <Chart key={w.id} w={w} />
        ) : w.kind === "confirm" ? (
          <Confirm key={w.id} w={w} />
        ) : (
          <Cards key={w.id} w={w} />
        ),
      )}
    </div>
  );
}

/** 되돌리기 어려운 작업의 확인 카드. [실행] 클릭 시에만 /api/mori/action 으로 실제 실행. */
function Confirm({ w }: { w: ConfirmWidget }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error" | "cancelled">("idle");
  const [msg, setMsg] = useState("");

  const run = async () => {
    setState("running");
    try {
      const res = await fetch("/api/mori/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: w.action.type, params: w.action.params }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        setState("done");
        setMsg(j.message ?? "실행했습니다.");
      } else {
        setState("error");
        setMsg(j.error ?? `실패 (HTTP ${res.status})`);
      }
    } catch (e: any) {
      setState("error");
      setMsg(e?.message ?? "네트워크 오류");
    }
  };

  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-200">
        <Send size={12} /> {w.title}
      </p>
      <p className="mb-2.5 whitespace-pre-wrap rounded-lg bg-black/20 px-3 py-2 text-xs leading-relaxed text-[#cdd7e6]">
        {w.detail}
      </p>

      {state === "idle" && (
        <div className="flex gap-2">
          <button
            onClick={run}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-400/90 py-2 text-xs font-semibold text-[#1A2332] transition hover:bg-amber-300"
          >
            <Send size={12} /> {w.confirmLabel ?? "실행"}
          </button>
          <button
            onClick={() => setState("cancelled")}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-[#9fb0c8] transition hover:bg-white/5"
          >
            취소
          </button>
        </div>
      )}
      {state === "running" && (
        <p className="flex items-center gap-1.5 text-xs text-amber-200">
          <Loader2 size={12} className="animate-spin" /> 실행 중…
        </p>
      )}
      {state === "done" && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
          <Check size={13} /> {msg}
        </p>
      )}
      {state === "error" && <p className="text-xs font-medium text-red-300">⚠️ {msg}</p>}
      {state === "cancelled" && <p className="text-xs text-[#7c8aa0]">취소됨 — 전송하지 않았습니다.</p>}
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
