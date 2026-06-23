"use client";
import { useState } from "react";

interface Counts { total: number; recent: number; relaunch: number; sent: number; pending: number }
interface Samples { recent: { subject: string; html: string }; relaunch: { subject: string; html: string } }

export default function ReviewCampaignPanel({ mall }: { mall: string }) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [samples, setSamples] = useState<Samples | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadPreview() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/reviews/admin/campaign?mall=${mall}`);
      const j = await r.json();
      if (j.ok) { setCounts(j.counts); setSamples(j.samples); }
      else setMsg(j.error || "preview 실패");
    } finally { setBusy(false); }
  }
  function toggle() { const n = !open; setOpen(n); if (n && !counts) loadPreview(); }

  function previewHtml(seg: "recent" | "relaunch") {
    if (!samples) return;
    const w = window.open("", "_blank");
    if (w) { w.document.write(samples[seg].html); w.document.title = samples[seg].subject; w.document.close(); }
  }

  async function sendTest() {
    if (!testEmail) { setMsg("테스트 받을 이메일을 입력하세요"); return; }
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/reviews/admin/campaign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "test", mall, testEmail }) });
      const j = await r.json();
      setMsg(j.ok ? `✅ 테스트 발송됨 → ${testEmail} (recent+relaunch 2통)` : `실패: ${j.error}`);
    } finally { setBusy(false); }
  }

  async function sendLive() {
    if (!counts) return;
    if (!confirm(`실제 고객 ${counts.pending}명에게 리뷰 요청 메일을 발송합니다. 진행할까요?`)) return;
    setBusy(true); setMsg("발송 중…");
    try {
      let total = 0, guard = 0;
      while (guard++ < 20) {
        const r = await fetch("/api/reviews/admin/campaign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "live", mall, limit: 40 }) });
        const j = await r.json();
        if (!j.ok) { setMsg(`발송 오류: ${j.error}`); break; }
        total += j.sent;
        setMsg(`발송 중… 누적 ${total}명, 남은 ${j.remaining}명`);
        if (j.remaining === 0 || j.sent === 0) { setMsg(`✅ 발송 완료 — 총 ${total}명`); break; }
      }
      await loadPreview();
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-white border rounded-lg mb-4">
      <button onClick={toggle} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="font-semibold">📨 리뷰 요청 발송 (과거 구매자)</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t pt-4">
          {!counts ? <p className="text-gray-500 text-sm">{busy ? "불러오는 중…" : "—"}</p> : (
            <>
              <div className="flex flex-wrap gap-3 text-sm mb-3">
                <span>대상 <b>{counts.total}</b></span>
                <span className="text-gray-400">·</span>
                <span>안부형 {counts.recent} · 리뉴얼형 {counts.relaunch}</span>
                <span className="text-gray-400">·</span>
                <span className="text-green-600">발송완료 {counts.sent}</span>
                <span className="text-amber-600 font-semibold">미발송 {counts.pending}</span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                <button onClick={() => previewHtml("recent")} className="text-xs px-2.5 py-1.5 border rounded hover:bg-gray-50">안부형 미리보기</button>
                <button onClick={() => previewHtml("relaunch")} className="text-xs px-2.5 py-1.5 border rounded hover:bg-gray-50">리뉴얼형 미리보기</button>
              </div>
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="테스트 받을 이메일" className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[180px]" />
                <button onClick={sendTest} disabled={busy} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50 disabled:opacity-50">테스트 발송</button>
              </div>
              <button onClick={sendLive} disabled={busy || counts.pending === 0} className="text-sm px-4 py-2 rounded bg-zinc-900 text-white disabled:opacity-50">
                실발송 ({counts.pending}명)
              </button>
            </>
          )}
          {msg && <p className="text-sm mt-3 text-gray-700">{msg}</p>}
        </div>
      )}
    </div>
  );
}
