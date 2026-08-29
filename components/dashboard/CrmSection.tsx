"use client";

/**
 * 대시보드 CRM 섹션 — 매일 보는 화면에 둔다(별도 페이지로 빼면 안 보게 된다).
 *
 * 이 섹션이 답하는 질문 셋:
 *   1. 연락 가능한 사람이 늘고 있나 (모수)
 *   2. 카드가 실제로 마켓 고객을 데려오나 (CARE 등록 · 채널별)
 *   3. 보낸 문자가 매출로 이어졌나 (캠페인 퍼널)
 *
 * 데이터가 없을 땐 숫자 0을 늘어놓는 대신 "무엇을 기다리는 중인지"를 적는다 —
 * 빈 표는 고장난 것처럼 보인다.
 */
import { useEffect, useState } from "react";

interface Overview {
  care: {
    total: number; today: number; week: number; consent: number; consentRate: number;
    batteryUsed: number;
    byChannel: Record<string, { total: number; consent: number }>;
    recent: Array<{ phone: string; product: string | null; consent: boolean; channel: string; at: string }>;
  };
  coupon: { total: number; free: number; used: number };
  campaigns: Array<{ id: string; name: string; sentAt: string | null; funnel: {
    sent: number; clicked: number; carted: number; purchased: number; revenue: number;
    clickRate: number; cvr: number } }>;
  reachable: { paulvice: number; harriot: number; harriotEmail: number };
}

const won = (n: number) => n.toLocaleString("ko-KR");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="mb-1.5 text-[11px] font-medium text-zinc-400">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-[22px] font-bold leading-none tracking-tight text-zinc-900 dark:text-zinc-100">{value}</span>
        {unit && <span className="text-[12px] text-zinc-400">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[11px] text-zinc-400">{sub}</div>}
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

  const ch = Object.entries(d.care.byChannel).sort((a, b) => b[1].total - a[1].total).slice(0, 6);

  return (
    <div className="space-y-4">
      {/* 모수 — 지금 광고를 보낼 수 있는 사람 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="폴바이스 연락가능" value={won(d.reachable.paulvice)} unit="명" sub="자사몰 6개월 이내" />
        <Stat label="해리엇 연락가능" value={won(d.reachable.harriot)} unit="명" sub={`이메일 ${d.reachable.harriotEmail}`} />
        <Stat label="CARE 등록" value={won(d.care.total)} unit="명" sub={`오늘 ${d.care.today} · 7일 ${d.care.week}`} />
        <Stat label="광고 동의(기한없음)" value={won(d.care.consent)} unit="명" sub={d.care.total ? `동의율 ${pct(d.care.consentRate)}` : "등록 대기"} />
      </div>

      {/* CARE 채널별 — 카드가 어느 마켓에서 사람을 데려오는지 */}
      {ch.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
          <div className="grid grid-cols-[1fr_70px_70px] bg-zinc-50 px-4 py-2 text-[11px] font-semibold text-zinc-400 dark:bg-zinc-800">
            <div>구매 채널</div><div className="text-right">등록</div><div className="text-right">동의</div>
          </div>
          {ch.map(([name, v]) => (
            <div key={name} className="grid grid-cols-[1fr_70px_70px] border-t border-zinc-100 bg-white px-4 py-2.5 text-[13px] dark:border-zinc-700 dark:bg-zinc-800">
              <div>{name}</div>
              <div className="text-right font-semibold">{v.total}</div>
              <div className="text-right text-zinc-400">{v.consent}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-3 text-[12.5px] leading-relaxed text-zinc-400 dark:border-zinc-700">
          아직 CARE 등록이 없습니다. 카드가 상자에 들어가기 시작하면 채널별로 여기 쌓입니다.
          쿠폰 잔여 {won(d.coupon.free)}장 / 총 {won(d.coupon.total)}장.
        </p>
      )}

      {/* 캠페인 퍼널 */}
      {d.campaigns.length > 0 && d.campaigns.map((c) => {
        const f = c.funnel;
        const max = Math.max(1, f.sent);
        const steps = [["발송", f.sent], ["클릭", f.clicked], ["장바구니", f.carted], ["구매", f.purchased]] as const;
        return (
          <div key={c.id} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="mb-3 flex items-baseline justify-between">
              <b className="text-[13.5px]">{c.name}</b>
              <span className="text-[11.5px] text-zinc-400">{c.sentAt ? c.sentAt.slice(0, 10) : "미발송"}</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {steps.map(([k, v]) => (
                <div key={k}>
                  <div className="mb-1.5 h-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-700">
                    <div className="h-full bg-zinc-900 dark:bg-zinc-200" style={{ width: `${(v / max) * 100}%` }} />
                  </div>
                  <div className="text-[11px] text-zinc-400">{k}</div>
                  <div className="text-[16px] font-bold">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-[11.5px] text-zinc-400">
              클릭률 {pct(f.clickRate)} · 구매전환 {pct(f.cvr)} · 매출 {won(f.revenue)}원
              {f.sent > 0 && ` · 발송 1건당 ${won(Math.round(f.revenue / f.sent))}원`}
            </div>
          </div>
        );
      })}

      <p className="text-[11.5px] leading-relaxed text-zinc-400">
        자사몰 구매자는 <b>거래 후 6개월</b>까지만 광고 발송이 됩니다(정보통신망법 §50 단서).
        CARE 동의는 기한이 없어, 그 숫자가 커질수록 6개월 시계에서 자유로워집니다.
      </p>
    </div>
  );
}
