"use client";
import { useCallback, useEffect, useState } from "react";
import BackToHubButton from "@/components/BackToHubButton";
import ReviewCampaignPanel from "@/components/ReviewCampaignPanel";
import ReviewSmsKrPanel from "@/components/ReviewSmsKrPanel";

interface MediaItem { type: "image" | "video"; url: string }
interface Review {
  id: string; mall: string; product_no: number; product_name: string;
  customer_name: string; customer_email: string | null; rating: number;
  content: string; media: MediaItem[]; media_type: string; reward_points: number;
  status: "published" | "hidden" | "spam"; cafe24_article_no: number | null;
  cafe24_synced: boolean; created_at: string;
}
interface Counts { published: number; hidden: number; spam: number; total: number }

const MALLS = [
  { id: "harriot_global", label: "Harriot (Global)" },
  { id: "harriot_kr", label: "Harriot (KR)" },
  { id: "paulvice_kr", label: "Paulvice (KR)" },
  { id: "paulvice_global", label: "Paulvice (Global)" },
];
const STATUS = [
  { id: "all", label: "전체" }, { id: "published", label: "게시중" },
  { id: "hidden", label: "숨김" }, { id: "spam", label: "스팸" },
];

function Stars({ n }: { n: number }) {
  return <span className="text-amber-500 tracking-tight">{"★".repeat(n)}<span className="text-gray-300">{"★".repeat(5 - n)}</span></span>;
}
function badge(s: string) {
  const map: Record<string, string> = { published: "bg-green-100 text-green-700", hidden: "bg-gray-200 text-gray-600", spam: "bg-red-100 text-red-700" };
  const lab: Record<string, string> = { published: "게시중", hidden: "숨김", spam: "스팸" };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[s] || ""}`}>{lab[s] || s}</span>;
}

export default function ReviewsAdmin() {
  const [mall, setMall] = useState("harriot_global");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Review[]>([]);
  const [counts, setCounts] = useState<Counts>({ published: 0, hidden: 0, spam: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ mall, status, q, limit: "200" });
      const r = await fetch(`/api/reviews/admin?${p}`);
      const j = await r.json();
      if (j.ok) { setRows(j.reviews); setCounts(j.counts); }
    } finally { setLoading(false); }
  }, [mall, status, q]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "hide" | "publish" | "spam") {
    setBusy(id);
    try {
      await fetch("/api/reviews/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
      await load();
    } finally { setBusy(null); }
  }

  function exportCsv() {
    const head = ["created_at", "mall", "product_no", "product_name", "rating", "customer_name", "customer_email", "media_type", "reward_points", "status", "content"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
    const lines = [head.join(","), ...rows.map((r) => head.map((h) => esc((r as unknown as Record<string, unknown>)[h])).join(","))];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `reviews_${mall}_${Date.now()}.csv`; a.click();
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <BackToHubButton />
      <div className="flex items-center justify-between flex-wrap gap-3 mt-2 mb-4">
        <h1 className="text-2xl font-bold">리뷰 관리</h1>
        <button onClick={exportCsv} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">CSV 내보내기</button>
      </div>

      {/* 국내(KR)는 문자+적립금, 그 외(글로벌)는 이메일 캠페인 */}
      {mall === "harriot_kr" || mall === "paulvice_kr"
        ? <ReviewSmsKrPanel mall={mall} />
        : <ReviewCampaignPanel mall={mall} />}

      {/* 통계 */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4">
        {([["total", "전체"], ["published", "게시중"], ["hidden", "숨김"], ["spam", "스팸"]] as const).map(([k, l]) => (
          <div key={k} className="bg-white border rounded-lg p-3 text-center">
            <div className="text-xl font-bold">{counts[k as keyof Counts] ?? 0}</div>
            <div className="text-xs text-gray-500">{l}</div>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select value={mall} onChange={(e) => setMall(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
          {MALLS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
          {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색(내용·이름·상품)" className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[160px]" />
      </div>

      {loading ? <p className="text-gray-500 py-10 text-center">불러오는 중…</p> : rows.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">리뷰가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className={`bg-white border rounded-lg p-4 ${r.status !== "published" ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Stars n={r.rating} />
                    {badge(r.status)}
                    {r.media_type === "video" && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 rounded">🎬 동영상</span>}
                    {r.media_type === "photo" && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 rounded">📷 사진</span>}
                    {r.cafe24_article_no ? <span className="text-xs text-gray-400">카페24 #{r.cafe24_article_no}</span> : <span className="text-xs text-orange-400">카페24 미게시</span>}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    <b className="text-gray-700">{r.customer_name}</b> · {r.product_name} · {new Date(r.created_at).toLocaleDateString("ko-KR")} · 보상 {r.reward_points.toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {r.status !== "published" && <button disabled={busy === r.id} onClick={() => act(r.id, "publish")} className="text-xs px-2.5 py-1 rounded bg-green-600 text-white disabled:opacity-50">게시</button>}
                  {r.status !== "hidden" && <button disabled={busy === r.id} onClick={() => act(r.id, "hide")} className="text-xs px-2.5 py-1 rounded border disabled:opacity-50">숨김</button>}
                  {r.status !== "spam" && <button disabled={busy === r.id} onClick={() => act(r.id, "spam")} className="text-xs px-2.5 py-1 rounded border border-red-300 text-red-600 disabled:opacity-50">스팸</button>}
                </div>
              </div>
              {r.content && <p className="text-sm text-gray-800 mt-2 whitespace-pre-wrap">{r.content}</p>}
              {r.media?.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {r.media.map((m, i) => m.type === "video"
                    ? <video key={i} src={m.url} controls className="w-28 h-28 object-cover rounded bg-black" />
                    : <img key={i} src={m.url} alt="" className="w-20 h-20 object-cover rounded" />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
