"use client";
import { useState } from "react";

const MALLS = [{ id: "paulvice", label: "폴바이스" }, { id: "harriot", label: "해리엇" }];

interface P {
  product_no: number; product_name: string;
  display: boolean; selling: boolean; reviewCount: number; group_key: string | null;
}

/** 리뷰 상품 연동 — 전시안함/단종 상품 리뷰를 활성 상품에 합쳐 노출. */
export default function ReviewLinkManager({ mall: mallProp }: { mall: string }) {
  const [mall, setMall] = useState<string>(mallProp?.startsWith("harriot") ? "harriot" : "paulvice");
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<P[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function search() {
    setLoading(true); setMsg("");
    try {
      const r = await fetch(`/api/reviews/admin/links?mall=${mall}&q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (j.ok) setProducts(j.products); else setMsg(j.error || "검색 실패");
    } catch { setMsg("검색 오류"); } finally { setLoading(false); }
  }
  function toggle(pn: number) { const n = new Set(sel); if (n.has(pn)) n.delete(pn); else n.add(pn); setSel(n); }
  async function link() {
    if (sel.size < 2) { setMsg("연동할 상품을 2개 이상 선택하세요"); return; }
    const r = await fetch("/api/reviews/admin/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mall, productNos: [...sel] }) });
    const j = await r.json();
    if (j.ok) { setMsg(`${j.count}개 상품 연동 완료 — 이제 리뷰가 합쳐서 노출됩니다`); setSel(new Set()); search(); }
    else setMsg(j.error || "연동 실패");
  }
  async function unlink(pn: number) {
    await fetch("/api/reviews/admin/links", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mall, productNo: pn }) });
    search();
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">
        전시안함·단종 상품에 달린 리뷰를 <b>활성 상품에 함께 노출</b>하려면, 대상 상품들을 골라 <b>연동</b>하세요.
        같은 그룹으로 묶인 상품끼리 리뷰(별점·사진 포함)가 합쳐집니다. (예: 색상만 다른 같은 시계, 리뉴얼 전/후 상품)
      </p>
      <div className="flex gap-2 mb-3 flex-wrap">
        <select value={mall} onChange={(e) => { setMall(e.target.value); setProducts([]); setSel(new Set()); }} className="border rounded px-2 py-1.5 text-sm">
          {MALLS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="상품명 검색 (예: 오드리)" className="border rounded px-3 py-1.5 text-sm flex-1 min-w-[160px]" />
        <button onClick={search} className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50">검색</button>
        <button onClick={link} disabled={sel.size < 2} className="text-sm px-3 py-1.5 rounded bg-zinc-900 text-white disabled:opacity-40">선택 {sel.size}개 연동</button>
      </div>
      {msg && <div className="text-sm mb-3 text-blue-600">{msg}</div>}
      {loading ? <div className="text-sm text-gray-400">불러오는 중…</div> : (
        <div className="space-y-1.5">
          {products.map((p) => (
            <label key={p.product_no} className="flex items-center gap-2.5 bg-white border rounded-lg p-2.5 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={sel.has(p.product_no)} onChange={() => toggle(p.product_no)} />
              <span className="text-xs text-gray-400 w-14 shrink-0">#{p.product_no}</span>
              <span className="text-sm flex-1 min-w-0 truncate">{p.product_name}</span>
              {!p.display && <span className="text-xs bg-orange-100 text-orange-600 px-1.5 rounded shrink-0">전시안함</span>}
              {!p.selling && <span className="text-xs bg-gray-200 text-gray-500 px-1.5 rounded shrink-0">판매안함</span>}
              <span className="text-xs text-gray-600 shrink-0">리뷰 {p.reviewCount}</span>
              {p.group_key && <span className="text-xs bg-green-100 text-green-700 px-1.5 rounded shrink-0" title={p.group_key}>연동됨</span>}
              {p.group_key && <button onClick={(e) => { e.preventDefault(); unlink(p.product_no); }} className="text-xs text-red-500 shrink-0">해제</button>}
            </label>
          ))}
          {!products.length && <div className="text-sm text-gray-400">상품명으로 검색하세요.</div>}
        </div>
      )}
    </div>
  );
}
