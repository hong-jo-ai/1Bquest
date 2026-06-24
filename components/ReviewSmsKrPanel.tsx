"use client";
import { useState } from "react";

interface PreviewItem { name: string; phone: string; product: string; order: string }
interface AutoSmsPreview {
  ok: boolean; scanned: number; alreadySent: number; pending: number;
  sample: { subject: string; text: string } | null;
  preview: PreviewItem[];
  error?: string;
}
interface RewardCounts { pending: number; paid: number; skipped: number; failed: number }

/** 국내(harriot_kr) 리뷰요청 문자 + 적립금 보상 운영 패널. */
export default function ReviewSmsKrPanel({ mall }: { mall: string }) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(14);
  const [pv, setPv] = useState<AutoSmsPreview | null>(null);
  const [reward, setReward] = useState<RewardCounts | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true); setMsg("");
    try {
      const [a, b] = await Promise.all([
        fetch(`/api/reviews/auto-sms?mall=${mall}&days=${days}`).then((r) => r.json()),
        fetch(`/api/reviews/admin/reward?mall=${mall}`).then((r) => r.json()),
      ]);
      if (a.ok) setPv(a); else setMsg(a.error || "조회 실패");
      if (b.ok) setReward(b.counts);
    } finally { setBusy(false); }
  }
  function toggle() { const n = !open; setOpen(n); if (n && !pv) load(); }

  async function sendTest() {
    if (!testPhone) { setMsg("테스트 받을 번호를 입력하세요"); return; }
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/reviews/auto-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "test", mall, testPhone }) });
      const j = await r.json();
      setMsg(j.ok ? `✅ 테스트 문자 발송 → ${testPhone} (${j.type}, 예상 ${j.estCost}원)` : `실패: ${j.error || JSON.stringify(j.results?.[0])}`);
    } finally { setBusy(false); }
  }

  async function sendLive() {
    if (!pv) return;
    if (!confirm(`최근 ${days}일 배송완료 ${pv.pending}건에 리뷰요청 문자를 발송합니다. 진행할까요?`)) return;
    setBusy(true); setMsg("발송 중…");
    try {
      const r = await fetch("/api/reviews/auto-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "live", mall, days }) });
      const j = await r.json();
      setMsg(j.ok ? `✅ 발송 완료 — 성공 ${j.successCount} / 실패 ${j.failCount} (${j.type}, 예상 ${j.estCost}원)` : `오류: ${j.error}`);
      await load();
    } finally { setBusy(false); }
  }

  async function payRewards() {
    if (!confirm("작성된 리뷰의 적립금을 카페24 회원에게 지급합니다. (회원 매칭분만) 진행할까요?")) return;
    setBusy(true); setMsg("적립금 지급 중…");
    try {
      const r = await fetch("/api/reviews/admin/reward", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mall, limit: 100 }) });
      const j = await r.json();
      setMsg(j.ok ? `✅ 지급 완료 — 적립 ${j.paid} · 비회원skip ${j.skipped} · 실패 ${j.failed}` : `오류: ${j.error}`);
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-white border rounded-lg mb-4">
      <button onClick={toggle} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="font-semibold">📱 국내 리뷰요청 문자 + 적립금 보상</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t pt-4">
          <div className="flex items-center gap-2 mb-3 text-sm">
            <span>최근</span>
            <input type="number" value={days} min={1} max={60} onChange={(e) => setDays(Number(e.target.value) || 14)} className="border rounded px-2 py-1 w-16" />
            <span>일 배송완료</span>
            <button onClick={load} disabled={busy} className="text-xs px-2.5 py-1 border rounded hover:bg-gray-50 disabled:opacity-50">새로고침</button>
          </div>

          {pv && (
            <>
              <div className="flex flex-wrap gap-3 text-sm mb-2">
                <span>조회 <b>{pv.scanned}</b></span>
                <span className="text-gray-400">·</span>
                <span className="text-green-600">발송완료 {pv.alreadySent}</span>
                <span className="text-amber-600 font-semibold">미발송 {pv.pending}</span>
              </div>
              {pv.sample && (
                <pre className="text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap mb-2 max-h-48 overflow-auto">{pv.sample.text}</pre>
              )}
              {pv.preview.length > 0 && (
                <div className="text-xs text-gray-500 mb-3">
                  {pv.preview.map((p, i) => <span key={i} className="inline-block mr-3">{p.name}({p.phone}) {p.product}</span>)}
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="테스트 받을 번호 010..." className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[160px]" />
                <button onClick={sendTest} disabled={busy} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50 disabled:opacity-50">테스트 발송</button>
              </div>
              <button onClick={sendLive} disabled={busy || pv.pending === 0} className="text-sm px-4 py-2 rounded bg-zinc-900 text-white disabled:opacity-50">
                문자 실발송 ({pv.pending}건)
              </button>
            </>
          )}

          {reward && (
            <div className="mt-4 pt-3 border-t">
              <div className="flex flex-wrap gap-3 text-sm mb-2">
                <span className="font-medium">적립금 보상</span>
                <span className="text-amber-600">미지급 {reward.pending}</span>
                <span className="text-green-600">지급완료 {reward.paid}</span>
                <span className="text-gray-400">비회원 {reward.skipped}</span>
                {reward.failed > 0 && <span className="text-red-600">실패 {reward.failed}</span>}
              </div>
              <button onClick={payRewards} disabled={busy || reward.pending === 0} className="text-sm px-4 py-2 rounded border border-amber-400 text-amber-700 disabled:opacity-50">
                적립금 지급 ({reward.pending}건)
              </button>
            </div>
          )}

          {msg && <p className="text-sm mt-3 text-gray-700">{msg}</p>}
        </div>
      )}
    </div>
  );
}
