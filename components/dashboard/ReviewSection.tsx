"use client";

/**
 * 대시보드 리뷰 섹션 — 리뷰요청이 실제로 리뷰가 되고 있는지.
 *
 * 이 화면이 있어야 하는 이유: 발송은 매일 돌아가는데 결과를 볼 데가 없어서
 * 두 달간 아무도 안 챙겼고, 그 사이 같은 번호로 반복 발송되고 있었다(2026-08-30 발견).
 * "잘 돌고 있나"를 매일 눈에 띄게 두는 것 자체가 장치다.
 *
 * 퍼널을 네 칸으로 쪼갠 이유: 전환율 한 숫자만 보면 어디를 고칠지 못 정한다.
 *   도달이 낮다 → 번호·채널 문제 / 열람이 낮다 → 문안·타이밍 문제
 *   작성이 낮다 → 폼·보상 문제
 */
import { useEffect, useState } from "react";

interface Delivery {
  sent: number; delivered: number; failed: number; deliveryRate: number;
  reasons: Array<{ reason: string; count: number; fixable: boolean }>;
  byType: Record<string, number>;
  cachedAt: string;
}
interface Metrics {
  days: number;
  requested: number; requestFailed: number; givenUp: number;
  delivery: Delivery | null;
  clicked: number; clickRate: number;
  written: number; conversionRate: number; clickToWriteRate: number;
  avgRating: number; ratingDist: Record<string, number>;
  byMall: Record<string, { requested: number; written: number }>;
  withPhoto: number;
  recent: Array<{ mall: string; product: string | null; rating: number | null; at: string; name: string | null }>;
  pending: number;
}

const num = (n: number) => n.toLocaleString("ko-KR");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const MALL_LABEL: Record<string, string> = { paulvice_kr: "폴바이스", harriot_kr: "해리엇" };

function Stat({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const c = tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : tone === "bad" ? "text-red-600 dark:text-red-400"
    : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-1.5 text-[11px] font-medium text-zinc-400">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={`text-[22px] font-bold leading-none tracking-tight ${c}`}>{value}</span>
        {unit && <span className="text-[12px] text-zinc-400">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}

/** 단계별 잔존율까지 같이 보여주는 퍼널. 어느 칸에서 떨어지는지가 곧 할 일이다. */
function Funnel({ steps }: { steps: Array<{ label: string; n: number; note?: string }> }) {
  const top = steps[0]?.n || 0;
  return (
    // 모바일은 2×2 그리드(가로 화살표는 폭을 넘긴다), sm 이상은 한 줄 흐름.
    <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-stretch">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].n : 0;
        const drop = i > 0 && prev > 0 ? s.n / prev : 1;
        return (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className="w-full rounded-lg bg-zinc-100 px-3 py-2 sm:w-auto sm:min-w-[92px] dark:bg-zinc-700/50">
              <div className="text-[10px] text-zinc-400">{s.label}</div>
              <div className="text-[16px] font-bold text-zinc-800 dark:text-zinc-100">{num(s.n)}</div>
              <div className="text-[10px] text-zinc-400">
                {i === 0 ? (s.note ?? " ") : `${top ? pct(s.n / top) : "—"} · 직전 ${pct(drop)}`}
              </div>
            </div>
            {i < steps.length - 1 && <span className="hidden text-zinc-300 sm:inline">→</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function ReviewSection() {
  const [d, setD] = useState<Metrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  // 기간을 바꾸면 새로 부른다. 이전 데이터는 지우지 않고 두는데,
  // 잠깐 빈 화면이 되는 것보다 옛 숫자가 잠시 남는 편이 덜 혼란스럽다.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reviews/overview?days=${days}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) setD(j); else setErr(j.error ?? "불러오기 실패");
      })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [days]);

  if (err) return <div className="py-3 text-[13px] text-red-600">리뷰 지표 불러오기 실패: {err}</div>;
  if (!d) return <div className="py-3 text-[13px] text-zinc-400">불러오는 중…</div>;

  const reach = d.delivery?.delivered ?? d.requested;
  const fixable = d.delivery?.reasons.filter((r) => r.fixable) ?? [];
  // 업계 평균이랄 게 없어서 우리 기준을 적는다: 도달 대비 10% 넘으면 정상, 5% 밑이면 손봐야 한다.
  const convTone = d.conversionRate >= 0.1 ? "good" : d.conversionRate >= 0.05 ? "warn" : "bad";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200">리뷰요청</h3>
          <span className="text-[11px] text-zinc-400">
            {d.delivery ? `알림톡 · ${Object.entries(d.delivery.byType).map(([k, v]) => `${k} ${v}`).join(" ")}` : "발송기록 조회 불가"}
          </span>
        </div>
        <div className="flex gap-1">
          {[30, 60, 90].map((n) => (
            <button
              key={n}
              onClick={() => setDays(n)}
              className={`rounded-md px-2 py-0.5 text-[11px] ${
                days === n ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "text-zinc-400 hover:text-zinc-600"
              }`}
            >{n}일</button>
          ))}
        </div>
      </div>

      {/* ── 퍼널 ── */}
      <Funnel steps={[
        { label: "요청", n: d.requested, note: `${d.days}일` },
        { label: "도달", n: reach, note: d.delivery ? undefined : "추정" },
        { label: "열람", n: d.clicked },
        { label: "작성", n: d.written },
      ]} />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        <Stat label="전환율" value={pct(d.conversionRate)} sub="도달 → 리뷰 작성" tone={convTone} />
        <Stat label="도달률" value={d.delivery ? pct(d.delivery.deliveryRate) : "—"}
              sub={d.delivery ? `실패 ${d.delivery.failed}건` : "솔라피 조회 실패"}
              tone={d.delivery && d.delivery.deliveryRate < 0.9 ? "warn" : undefined} />
        <Stat label="열람률" value={d.clicked ? pct(d.clickRate) : "—"}
              sub={d.clicked ? `열람 후 작성 ${pct(d.clickToWriteRate)}` : "8/30부터 집계 시작"} />
        <Stat label="평균 별점" value={d.avgRating ? d.avgRating.toFixed(2) : "—"}
              sub={`사진리뷰 ${d.withPhoto}건`} />
        <Stat label="미작성" value={num(d.pending)} unit="건" sub="도달했지만 아직 안 씀" />
      </div>

      {/* 열람 집계는 최근에 붙였다 — 0이 고장으로 보이지 않게 명시한다. */}
      {d.clicked === 0 && (
        <div className="rounded-lg bg-zinc-50 px-3 py-2 text-[11px] text-zinc-500 dark:bg-zinc-800/50">
          열람 집계는 2026-08-30부터 시작했습니다. 그 전 발송분은 클릭 기록이 없어 0으로 나옵니다 —
          며칠 쌓이면 &ldquo;안 열어본 것&rdquo;과 &ldquo;열었는데 안 쓴 것&rdquo;을 구분할 수 있습니다.
        </div>
      )}

      {/* ── 실패 사유 ── */}
      {d.delivery && d.delivery.failed > 0 && (
        <div>
          <div className="mb-1.5 px-1 text-[11px] font-semibold text-zinc-500">
            도달 실패 {d.delivery.failed}건
            {fixable.length > 0 && <span className="ml-1 text-amber-600">· {fixable.reduce((a, r) => a + r.count, 0)}건은 고칠 수 있음</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.delivery.reasons.map((r) => (
              <span key={r.reason}
                className={`rounded-lg px-2.5 py-1 text-[11px] ${
                  r.fixable
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}>
                {r.reason} <b>{r.count}</b>
              </span>
            ))}
          </div>
          <div className="mt-1 px-1 text-[10px] text-zinc-400">
            회색은 고객이 카톡을 안 쓰거나 차단한 경우 — 우리가 못 고친다. 주황색만 손볼 대상.
          </div>
        </div>
      )}

      {/* ── 몰별 ── */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-[11px] sm:text-[12px]">
          <thead className="bg-zinc-50 text-[11px] text-zinc-500 dark:bg-zinc-800/60">
            <tr>
              <th className="px-2.5 py-2 text-left font-medium">몰</th>
              <th className="px-2.5 py-2 text-right font-medium">요청</th>
              <th className="px-2.5 py-2 text-right font-medium">작성</th>
              <th className="px-2.5 py-2 text-right font-medium">전환율</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
            {Object.entries(d.byMall).sort((a, b) => b[1].requested - a[1].requested).map(([mall, v]) => (
              <tr key={mall}>
                <td className="px-2.5 py-2 font-medium text-zinc-700 dark:text-zinc-200">{MALL_LABEL[mall] ?? mall}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{num(v.requested)}</td>
                <td className="px-2.5 py-2 text-right font-semibold tabular-nums">{num(v.written)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">
                  {v.requested ? pct(v.written / v.requested) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 최근 리뷰 ── */}
      {d.recent.length > 0 && (
        <div>
          <div className="mb-1.5 px-1 text-[11px] font-semibold text-zinc-500">최근 리뷰</div>
          <div className="space-y-1">
            {d.recent.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 text-[11px] dark:bg-zinc-800/50">
                <span className="text-amber-500">{"★".repeat(Math.round(r.rating ?? 0))}</span>
                <span className="truncate text-zinc-600 dark:text-zinc-300">{r.product ?? "상품미상"}</span>
                <span className="ml-auto shrink-0 text-zinc-400">
                  {MALL_LABEL[r.mall] ?? r.mall} · {r.at.slice(5, 10)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
