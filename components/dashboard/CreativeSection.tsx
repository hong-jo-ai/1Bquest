"use client";

/**
 * 소재별 광고 성과 — 어떤 소재가 파는지.
 *
 * 데이터는 원래부터 쌓이고 있었는데(mads_ads + mads_ad_daily_metrics) 화면이 없어서
 * "후킹 문구가 나은가 착용컷이 나은가" 를 감으로 답하고 있었다(2026-08-30).
 *
 * ⚠️ CTR 로 소재를 고르면 반대로 간다. 실측 — CTR 10.1% 소재의 ROAS 가 0.50,
 *    CTR 6.5% 소재의 ROAS 가 6.89 였다. 그래서 둘을 나란히 두고,
 *    **정렬 기준은 지출**로 한다(무엇에 돈이 흘러가고 있는지가 먼저다).
 */
import { useEffect, useState } from "react";

interface Row {
  metaAdId: string; name: string; status: string; format: string | null;
  campaignName: string | null;
  spend: number; revenue: number; conversions: number;
  impressions: number; clicks: number;
  roas: number | null; ctr: number | null; cpa: number | null; days: number;
}
interface Data {
  brand: string; days: number;
  totals: { spend: number; revenue: number; roas: number | null; creatives: number };
  rows: Row[];
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const money = (n: number) => (n >= 10_000 ? `${Math.round(n / 10_000)}만` : won(n));
const dash = (n: number | null, f: (v: number) => string) => (n === null || !isFinite(n) ? "—" : f(n));

/** ROAS 색: 3 이상이면 좋음, 1 미만이면 손해 구간. */
function roasTone(v: number | null) {
  if (v === null) return "text-zinc-400";
  if (v >= 3) return "text-emerald-600 dark:text-emerald-400";
  if (v >= 1) return "text-zinc-700 dark:text-zinc-200";
  return "text-red-600 dark:text-red-400";
}

const STATUS_KO: Record<string, string> = {
  ACTIVE: "진행", PAUSED: "중지", ADSET_PAUSED: "세트중지",
  CAMPAIGN_PAUSED: "캠페인중지", DISAPPROVED: "거부", WITH_ISSUES: "이슈",
  PENDING_REVIEW: "검수중",
};

export default function CreativeSection({ brand }: { brand: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(14);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/mads/creatives?brand=${brand}&days=${days}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) setD(j); else setErr(j.error ?? "불러오기 실패");
      })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [brand, days]);

  if (err) return <div className="py-3 text-[13px] text-red-600">소재 성과 불러오기 실패: {err}</div>;
  if (!d) return <div className="py-3 text-[13px] text-zinc-400">불러오는 중…</div>;

  if (d.rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-[12px] text-zinc-500 dark:border-zinc-600">
        최근 {d.days}일간 지출이 있는 소재가 없습니다.
      </div>
    );
  }

  // 참고용: CTR 1위와 ROAS 1위가 다르면 그 사실 자체가 판단에 중요하다.
  const byCtr = [...d.rows].filter((r) => r.ctr !== null).sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0))[0];
  const byRoas = [...d.rows].filter((r) => r.roas !== null && r.spend > 30000).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  const mismatch = byCtr && byRoas && byCtr.metaAdId !== byRoas.metaAdId;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200">소재별 성과</h3>
          <span className="text-[11px] text-zinc-400">
            {d.rows.length}개 · 지출 {money(d.totals.spend)}원 · ROAS {dash(d.totals.roas, (v) => v.toFixed(2))}
          </span>
        </div>
        <div className="flex gap-1">
          {[7, 14, 30].map((n) => (
            <button key={n} onClick={() => setDays(n)}
              className={`rounded-md px-2 py-0.5 text-[11px] ${
                days === n ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
              }`}>{n}일</button>
          ))}
        </div>
      </div>

      {/* 모바일 — 카드. 8열 표는 가로스크롤 없이는 안 들어간다. */}
      <div className="space-y-2 sm:hidden">
        {d.rows.map((r) => (
          <div key={r.metaAdId} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">{r.name}</span>
              <span className={`shrink-0 text-[17px] font-bold tabular-nums ${roasTone(r.roas)}`}>
                {dash(r.roas, (v) => v.toFixed(2))}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-y-1.5 text-[11px]">
              {[
                ["지출", `${money(r.spend)}원`],
                ["매출", `${money(r.revenue)}원`],
                ["전환", `${won(r.conversions)}건`],
                ["CTR", dash(r.ctr, (v) => `${v.toFixed(2)}%`)],
                ["전환당", dash(r.cpa, (v) => `${money(v)}원`)],
                ["상태", STATUS_KO[r.status] ?? r.status],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-zinc-400">{k}</div>
                  <div className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">{v}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 데스크톱 — 표 */}
      <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 sm:block dark:border-zinc-700">
        <table className="w-full min-w-[760px] text-[12px]">
          <thead className="bg-zinc-50 text-[11px] text-zinc-500 dark:bg-zinc-800/60">
            <tr>
              {["소재", "상태", "지출", "매출", "전환", "전환당", "CTR", "ROAS"].map((h) => (
                <th key={h} className={`px-2.5 py-2 font-medium ${h === "소재" ? "text-left" : "text-right"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
            {d.rows.map((r) => (
              <tr key={r.metaAdId} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-2.5 py-2">
                  <div className="font-medium text-zinc-800 dark:text-zinc-100">{r.name}</div>
                  <div className="text-[10px] text-zinc-400">
                    {r.format ?? "-"} · {r.days}일 노출
                  </div>
                </td>
                <td className="px-2.5 py-2 text-right text-[11px] text-zinc-500">{STATUS_KO[r.status] ?? r.status}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{won(r.spend)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{won(r.revenue)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{won(r.conversions)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{dash(r.cpa, won)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{dash(r.ctr, (v) => `${v.toFixed(2)}%`)}</td>
                <td className={`px-2.5 py-2 text-right font-bold tabular-nums ${roasTone(r.roas)}`}>
                  {dash(r.roas, (v) => v.toFixed(2))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mismatch && (
        <p className="px-1 text-[11px] text-amber-600 dark:text-amber-400">
          ⚠️ CTR 1위(<b>{byCtr.name}</b> {byCtr.ctr?.toFixed(2)}%)와 ROAS 1위(<b>{byRoas.name}</b> {byRoas.roas?.toFixed(2)})가
          다릅니다 — 클릭 잘 나오는 소재와 파는 소재는 별개입니다. 소재 판단은 ROAS로 하세요.
        </p>
      )}
    </div>
  );
}
