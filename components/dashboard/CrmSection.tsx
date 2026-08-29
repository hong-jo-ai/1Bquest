"use client";

/**
 * 대시보드 CRM 섹션 — 매일 보는 화면에 둔다(별도 페이지로 빼면 안 보게 된다).
 *
 * 광고관리자와 같은 방식으로 읽히게 만들었다: 위에 성과 요약,
 * 아래에 캠페인 한 줄씩(발송·클릭·CTR·전환·CVR·비용·CPA·매출·ROAS).
 *
 * 숫자를 쓸 때 지킨 것
 *  - 분모가 0이면 값을 지어내지 않고 "—" 로 둔다.
 *  - ROAS 가 수십~수백으로 찍혀도 정상이다(문자 20~50원, 카드 122원).
 *    대신 그게 "문자 덕분"이라는 뜻은 아니라서, 홀드아웃이 있을 때만 증분을 따로 쓴다.
 *  - 데이터가 없을 땐 0 을 늘어놓지 않고 무엇을 기다리는 중인지 적는다.
 */
import { useEffect, useState } from "react";

interface Holdout {
  size: number; purchased: number; baseCvr: number; liftPp: number;
  incrementalPurchases: number; incrementalRevenue: number; incrementalRoas: number | null;
}
interface CampaignMetrics {
  id: string; name: string; sentAt: string | null; status: string;
  targets: number; sent: number; delivered: number; clicked: number; carted: number; purchased: number;
  revenue: number; cost: number; ctr: number; cvr: number; clickCvr: number;
  cpc: number | null; cpa: number | null; roas: number | null; aov: number; revenuePerSend: number;
  holdout: Holdout | null;
}
interface CareMetrics {
  cardsShipped: number; cardCost: number; registered: number; registerRate: number;
  costPerRegistration: number | null; consent: number; consentRate: number;
  buyers: number; buyerRate: number; revenue: number; aov: number;
  revenuePerRegistration: number; roas: number | null;
  couponUsed: number; couponUseRate: number; since: string | null; daysRunning: number;
  byChannel: Record<string, { total: number; consent: number; buyers: number; revenue: number }>;
}
interface Overview {
  totals: { revenue: number; cost: number; roas: number | null; conversions: number; cpa: number | null; incrementalRevenue: number | null };
  campaigns: CampaignMetrics[];
  care: CareMetrics | null;
  coupon: { total: number; free: number; used: number };
  recent: Array<{ phone: string; product: string | null; consent: boolean; channel: string; at: string; orders: number; revenue: number }>;
  reachable: { paulvice: number; harriot: number; harriotEmail: number };
}

const won  = (n: number) => Math.round(n).toLocaleString("ko-KR");
const pct  = (n: number) => `${(n * 100).toFixed(1)}%`;
/** 분모가 없어서 계산이 안 되는 칸. 0 으로 찍으면 "성과 없음"으로 오해된다. */
const dash = (n: number | null, f: (v: number) => string) => (n === null || !isFinite(n) ? "—" : f(n));
const money = (n: number) => (n >= 10_000_000 ? `${(n / 100_000_000).toFixed(2)}억` : n >= 10_000 ? `${(n / 10_000).toFixed(0)}만` : won(n));

function Stat({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: "good" | "warn" }) {
  const c = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-100";
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

/** 퍼널 한 줄 — 단계마다 남은 비율을 같이 보여준다. 어디서 새는지가 개선 지점이다. */
function Funnel({ steps }: { steps: Array<{ label: string; n: number }> }) {
  const top = steps[0]?.n || 0;
  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1.5">
          <div className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-700/50">
            <div className="text-[10px] text-zinc-400">{s.label}</div>
            <div className="text-[15px] font-bold text-zinc-800 dark:text-zinc-100">{won(s.n)}</div>
            {i > 0 && <div className="text-[10px] text-zinc-400">{top ? pct(s.n / top) : "—"}</div>}
          </div>
          {i < steps.length - 1 && <span className="text-zinc-300">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function CrmSection() {
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/crm/overview")
      .then((r) => r.json())
      .then((j) => (j.ok ? setD(j) : setErr(j.error ?? "불러오기 실패")))
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="py-3 text-[13px] text-red-600">CRM 불러오기 실패: {err}</div>;
  if (!d) return <div className="py-3 text-[13px] text-zinc-400">불러오는 중…</div>;

  const care = d.care;
  const ch = care ? Object.entries(care.byChannel).sort((a, b) => b[1].total - a[1].total).slice(0, 6) : [];
  const sentCampaigns = d.campaigns.filter((c) => c.sent > 0);

  return (
    <div className="space-y-5">
      {/* ── 성과 요약 — 광고관리자 상단과 같은 자리, 같은 질문 ── */}
      <div>
        <div className="mb-2 flex items-baseline gap-2 px-1">
          <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200">성과</h3>
          <span className="text-[11px] text-zinc-400">CRM 이 만든 매출과 그 비용</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
          <Stat label="기여 매출" value={money(d.totals.revenue)} unit="원"
                sub={d.totals.incrementalRevenue !== null ? `증분 ${money(d.totals.incrementalRevenue)}원` : "증분은 홀드아웃 있을 때만"}
                tone={d.totals.revenue > 0 ? "good" : undefined} />
          <Stat label="비용" value={money(d.totals.cost)} unit="원" sub="문자 + CARE 카드" />
          <Stat label="ROAS" value={dash(d.totals.roas, (v) => `${v.toFixed(1)}x`)} sub="매출 ÷ 비용" />
          <Stat label="전환" value={won(d.totals.conversions)} unit="건" sub="문자·CARE 경유 구매" />
          <Stat label="전환당 비용" value={dash(d.totals.cpa, (v) => `${won(v)}`)} unit="원" sub="CPA" />
        </div>
      </div>

      {/* ── 캠페인 표 — 행 하나가 캠페인 하나 ── */}
      <div>
        <div className="mb-2 flex items-baseline gap-2 px-1">
          <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200">캠페인</h3>
          <span className="text-[11px] text-zinc-400">발송 → 클릭 → 구매</span>
        </div>
        {sentCampaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-[12px] text-zinc-500 dark:border-zinc-600">
            아직 발송한 캠페인이 없다. 첫 발송은 <b>설월(9/10)</b>·<b>옥타곤(9월 입고)</b> 예정 —
            그때부터 이 표에 ROAS 가 찍힌다.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
            <table className="w-full min-w-[820px] text-[12px]">
              <thead className="bg-zinc-50 text-[11px] text-zinc-500 dark:bg-zinc-800/60">
                <tr>
                  {["캠페인", "발송", "도달", "클릭", "CTR", "장바구니", "구매", "CVR", "비용", "CPC", "CPA", "매출", "ROAS"].map((h) => (
                    <th key={h} className={`px-2.5 py-2 font-medium ${h === "캠페인" ? "text-left" : "text-right"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                {sentCampaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="px-2.5 py-2">
                      <div className="font-medium text-zinc-800 dark:text-zinc-100">{c.name}</div>
                      <div className="text-[10px] text-zinc-400">
                        {c.sentAt ? c.sentAt.slice(0, 10) : "미발송"}
                        {c.holdout && ` · 홀드아웃 ${c.holdout.size}명`}
                      </div>
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{won(c.sent)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{won(c.delivered)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">{won(c.clicked)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{pct(c.ctr)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{won(c.carted)}</td>
                    <td className="px-2.5 py-2 text-right font-semibold tabular-nums">{won(c.purchased)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{pct(c.cvr)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{won(c.cost)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{dash(c.cpc, won)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{dash(c.cpa, won)}</td>
                    <td className="px-2.5 py-2 text-right font-semibold tabular-nums">{money(c.revenue)}</td>
                    <td className="px-2.5 py-2 text-right font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {dash(c.roas, (v) => `${v.toFixed(0)}x`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sentCampaigns.some((c) => c.holdout) && (
          <div className="mt-2 space-y-1 px-1">
            {sentCampaigns.filter((c) => c.holdout).map((c) => (
              <div key={c.id} className="text-[11px] text-zinc-500">
                <b>{c.name}</b> 증분 — 홀드아웃 구매율 {pct(c.holdout!.baseCvr)} vs 발송군 {pct(c.cvr)} ·
                문자 덕분에 는 구매 {c.holdout!.incrementalPurchases.toFixed(0)}건 /
                증분매출 {money(c.holdout!.incrementalRevenue)}원
                {c.holdout!.liftPp <= 0 && " ⚠️ 차이 없음 — 이 명단엔 문자가 안 먹혔다"}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── CARE — 카드 한 장이 자사몰 고객으로 이어지나 ── */}
      <div>
        <div className="mb-2 flex items-baseline gap-2 px-1">
          <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200">PAULVICE CARE</h3>
          <span className="text-[11px] text-zinc-400">
            {care?.since ? `${care.since} 시작 · ${care.daysRunning}일차` : "카드 투입 전"}
          </span>
        </div>
        {!care || care.registered === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-5 text-[12px] text-zinc-500 dark:border-zinc-600">
            카드 1,000장 입고 완료(122,100원 · 장당 122원). 박스에 넣기 시작하면 여기에
            <b> 배포 → 등록 → 자사몰 구매</b> 퍼널이 채워진다. 쿠폰 시리얼 {won(d.coupon.free)}장 대기.
          </div>
        ) : (
          <div className="space-y-3">
            <Funnel steps={[
              { label: "카드 배포", n: care.cardsShipped },
              { label: "등록", n: care.registered },
              { label: "광고동의", n: care.consent },
              { label: "자사몰 구매", n: care.buyers },
            ]} />
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
              <Stat label="등록률" value={pct(care.registerRate)} sub={`배포 ${won(care.cardsShipped)} → 등록 ${won(care.registered)}`} />
              <Stat label="등록당 비용" value={dash(care.costPerRegistration, won)} unit="원" sub={`카드비 ${money(care.cardCost)}원`} />
              <Stat label="구매 전환" value={pct(care.buyerRate)} sub={`등록자 ${won(care.registered)}명 중 ${won(care.buyers)}명`}
                    tone={care.buyerRate > 0 ? "good" : "warn"} />
              <Stat label="등록자 1인 매출" value={won(care.revenuePerRegistration)} unit="원" sub={`객단가 ${money(care.aov)}원`} />
              <Stat label="ROAS" value={dash(care.roas, (v) => `${v.toFixed(1)}x`)} sub="매출 ÷ 카드비" />
            </div>
            {ch.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700">
                <table className="w-full min-w-[460px] text-[12px]">
                  <thead className="bg-zinc-50 text-[11px] text-zinc-500 dark:bg-zinc-800/60">
                    <tr>
                      <th className="px-2.5 py-2 text-left font-medium">구매 채널</th>
                      <th className="px-2.5 py-2 text-right font-medium">등록</th>
                      <th className="px-2.5 py-2 text-right font-medium">동의</th>
                      <th className="px-2.5 py-2 text-right font-medium">자사몰 구매</th>
                      <th className="px-2.5 py-2 text-right font-medium">전환율</th>
                      <th className="px-2.5 py-2 text-right font-medium">매출</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                    {ch.map(([name, v]) => (
                      <tr key={name}>
                        <td className="px-2.5 py-2 font-medium text-zinc-700 dark:text-zinc-200">{name}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{won(v.total)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{won(v.consent)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums font-semibold">{won(v.buyers)}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums text-zinc-500">{v.total ? pct(v.buyers / v.total) : "—"}</td>
                        <td className="px-2.5 py-2 text-right tabular-nums">{money(v.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-2.5 py-1.5 text-[10px] text-zinc-400">
                  마켓(무신사·W컨셉·29CM) 행이 자사몰 구매로 이어졌다면 CARE 가 제 역할을 한 것이다 — 카드의 존재 이유가 그거다.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 모수 — 다음 캠페인의 상한 ── */}
      <div>
        <div className="mb-2 flex items-baseline gap-2 px-1">
          <h3 className="text-[13px] font-bold text-zinc-700 dark:text-zinc-200">연락 가능 모수</h3>
          <span className="text-[11px] text-zinc-400">자사몰 직접구매 180일 이내 + 대기명단</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <Stat label="폴바이스" value={won(d.reachable.paulvice)} unit="명" sub="문자 발송 가능" />
          <Stat label="해리엇" value={won(d.reachable.harriot)} unit="명" sub={`이메일 ${won(d.reachable.harriotEmail)}명 포함`} />
          <Stat label="쿠폰 시리얼" value={won(d.coupon.free)} unit="장 남음" sub={`총 ${won(d.coupon.total)}장 · 배정 ${won(d.coupon.used)}`}
                tone={d.coupon.free < 50 ? "warn" : undefined} />
          <Stat label="최근 등록" value={won(d.recent.length)} unit="건" sub={d.recent[0] ? `최신 ${d.recent[0].at.slice(5, 10)} ${d.recent[0].channel}` : "아직 없음"} />
        </div>
      </div>
    </div>
  );
}
