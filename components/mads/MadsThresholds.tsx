"use client";

import { useEffect, useState } from "react";
import { Settings, Info, Loader2, Check } from "lucide-react";
import type { MarginConfig } from "@/lib/mads/marginConfig";

interface ThresholdsResponse {
  ok: boolean;
  config: MarginConfig;
  thresholds: { beRoas: number; roasLow: number; roasBase: number; roasHigh: number };
  seasonModifier: number;
}

export default function MadsThresholds() {
  const [data, setData] = useState<ThresholdsResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ price: number; cogs: number; packaging: number; shipping: number }>({
    price: 0, cogs: 0, packaging: 0, shipping: 0,
  });

  const load = async () => {
    const res = await fetch("/api/mads/margin-config");
    const json: ThresholdsResponse = await res.json();
    setData(json);
    setDraft({
      price:      json.config.calc.price,
      cogs:       json.config.calc.cogs,
      packaging:  json.config.calc.packaging,
      shipping:   json.config.calc.shipping,
    });
  };

  useEffect(() => { load(); }, []);

  if (!data) return null;

  const recompute = (price: number, cogs: number, packaging: number, shipping: number) => {
    const fee = price * data.config.calc.channelFeeRate;
    const vat = (price - cogs) / 11;
    const cm = Math.max(0, price - cogs - packaging - shipping - fee - vat);
    const cmRate = price > 0 ? cm / price : 0;
    const beRoas = cm > 0 ? +(price / cm).toFixed(2) : 0;
    return { fee: Math.round(fee), vat: Math.round(vat), cm: Math.round(cm), cmRate: +cmRate.toFixed(3), beRoas };
  };

  const preview = recompute(draft.price, draft.cogs, draft.packaging, draft.shipping);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/mads/margin-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beRoas: preview.beRoas,
          calc: {
            price: draft.price, cogs: draft.cogs, packaging: draft.packaging, shipping: draft.shipping,
            vatBurden: preview.vat, contributionMargin: preview.cm, contributionMarginRate: preview.cmRate,
          },
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSavedAt(Date.now());
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30"
      >
        <div className="flex items-center gap-2 text-left">
          <Settings size={14} className="text-zinc-400" />
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            BE ROAS <span className="text-zinc-500 font-normal mx-1">{data.thresholds.beRoas}</span>
            <span className="mx-1 text-zinc-300">·</span>
            종료 &lt;{data.thresholds.roasLow}
            <span className="mx-1 text-zinc-300">·</span>
            증액 ≥{data.thresholds.roasBase}
            <span className="mx-1 text-zinc-300">·</span>
            공격증액 ≥{data.thresholds.roasHigh}
          </span>
          {data.seasonModifier !== 0 && (
            <span className="text-[10px] text-violet-600 bg-violet-50 dark:bg-violet-900/30 px-2 py-0.5 rounded-full">
              시즌 +{data.seasonModifier}
            </span>
          )}
        </div>
        <span className="text-[11px] text-zinc-400">{open ? "닫기" : "조정"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-4">
          <div className="bg-violet-50 dark:bg-violet-950/30 rounded-xl px-3 py-2 flex items-start gap-2">
            <Info size={12} className="text-violet-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-violet-700 dark:text-violet-300 leading-relaxed">
              기준 상품: <strong>{data.config.referenceProduct}</strong>. 모든 임계값은 BE ROAS의 배수로 자동 계산됨 (종료 ×{data.config.multipliers.low} / 증액 ×{data.config.multipliers.base} / 공격 ×{data.config.multipliers.high}).
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="판매가" value={draft.price} onChange={(v) => setDraft({ ...draft, price: v })} />
            <Field label="COGS" value={draft.cogs} onChange={(v) => setDraft({ ...draft, cogs: v })} />
            <Field label="포장재" value={draft.packaging} onChange={(v) => setDraft({ ...draft, packaging: v })} />
            <Field label="택배" value={draft.shipping} onChange={(v) => setDraft({ ...draft, shipping: v })} />
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-800/30 rounded-xl px-3 py-2.5 text-[11px] text-zinc-600 dark:text-zinc-400 space-y-0.5">
            <p>채널 수수료 ({(data.config.calc.channelFeeRate * 100).toFixed(2)}%): <strong>{preview.fee.toLocaleString("ko-KR")}원</strong></p>
            <p>부가세 부담 ((판매가-COGS)/11): <strong>{preview.vat.toLocaleString("ko-KR")}원</strong></p>
            <p>공헌이익: <strong>{preview.cm.toLocaleString("ko-KR")}원</strong> (이익률 {(preview.cmRate * 100).toFixed(1)}%)</p>
            <p className="text-zinc-900 dark:text-zinc-100 font-bold pt-1 border-t border-zinc-200/60 dark:border-zinc-700/40">
              → BE ROAS = <span className="text-violet-600 dark:text-violet-400">{preview.beRoas}</span>
            </p>
          </div>

          <button
            onClick={save}
            disabled={saving || preview.beRoas === data.config.beRoas}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : savedAt ? <Check size={12} /> : null}
            {savedAt && Date.now() - savedAt < 3000 ? "저장됨" : "저장 (다음 평가 사이클부터 적용)"}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm tabular-nums text-zinc-900 dark:text-zinc-100"
      />
    </label>
  );
}
