"use client";

import React, { useRef, useState } from "react";
import { Paperclip, FileText, Image as ImageIcon, Sheet, Trash2, Plus, Check, Loader2 } from "lucide-react";

export const DOC_KINDS = ["견적서", "발주서", "거래명세표", "사급출고증", "검수확인서", "세금계산서", "기타"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** 발주 상세에 항상 자리를 만들어 두는 슬롯 — 비어있으면 "미수령"이 눈에 띄어야 한다 */
const SLOTS: DocKind[] = ["견적서", "발주서", "거래명세표", "세금계산서"];

export interface PashoDoc {
  id: string; orderNo: string; kind: DocKind; title: string;
  mime: string; size: number; at: string; source: "web" | "telegram";
  docDate?: string | null; currency?: "KRW" | "USD" | null;
  supplyAmount?: number | null; vat?: number | null; totalAmount?: number | null;
  items?: { name: string; qty?: number }[] | null;
  receiptId?: string | null; note?: string | null; paid?: boolean;
}

function KindIcon({ mime }: { mime: string }) {
  if (mime.startsWith("image/")) return <ImageIcon size={13} />;
  if (mime.includes("sheet") || mime.includes("excel")) return <Sheet size={13} />;
  return <FileText size={13} />;
}

const money = (d: PashoDoc) => {
  const n = d.totalAmount ?? d.supplyAmount;
  if (n == null) return null;
  return `${d.currency === "USD" ? "$" : "₩"}${n.toLocaleString("ko-KR")}`;
};

export default function PashoDocs({
  orderNo, docs, onChanged,
}: { orderNo: string; docs: PashoDoc[]; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocKind>("견적서");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pick = (k: DocKind) => { setKind(k); setErr(null); fileRef.current?.click(); };

  const upload = async (file: File) => {
    setBusy("upload"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("orderNo", orderNo);
      fd.append("kind", kind);
      fd.append("title", file.name);
      const res = await fetch("/api/pasho/docs", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "업로드 실패");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/pasho/docs/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "변경 실패");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const remove = async (d: PashoDoc) => {
    if (!confirm(`'${d.title}' 증빙을 삭제할까요? 원본 파일도 함께 지워집니다.`)) return;
    setBusy(d.id);
    try {
      const res = await fetch(`/api/pasho/docs/${d.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("삭제 실패");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };

  const missing = SLOTS.filter((k) => !docs.some((d) => d.kind === k));

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-[#9A968E] uppercase tracking-wider">증빙</div>
        <button
          onClick={() => pick("기타")}
          disabled={busy === "upload"}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#6B6863] hover:text-[#1C1B1A] disabled:opacity-50"
        >
          {busy === "upload" ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} 파일 첨부
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf,.xlsx,.xls"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
      />

      {/* 보관된 증빙 */}
      {docs.length > 0 && (
        <div className="bg-white border border-[#E5E2DC] rounded-lg overflow-hidden mb-2">
          {docs.map((d) => (
            <div key={d.id} className="px-3.5 py-2.5 border-b border-[#F0EEE9] last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-[#9A968E] shrink-0"><KindIcon mime={d.mime} /></span>
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                  style={{ color: "#3A6EA5", background: "#EAF0F6" }}
                >
                  {d.kind}
                </span>
                <a
                  href={`/api/pasho/docs/${d.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12.5px] font-medium truncate hover:underline"
                  title={d.title}
                >
                  {d.title}
                </a>
                <button
                  onClick={() => remove(d)}
                  disabled={busy === d.id}
                  className="ml-auto p-1 rounded hover:bg-[#F4F2ED] text-[#C9C5BD] hover:text-[#B4472E] shrink-0"
                  title="삭제"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 pl-[22px] text-[11px] text-[#9A968E]">
                <span>{(d.docDate || d.at.slice(0, 10))}</span>
                {d.source === "telegram" && <span className="text-[#3F7A57]">텔레그램 자동보관</span>}
                {money(d) && <span className="tabular-nums font-semibold text-[#1C1B1A]">{money(d)}</span>}
                {d.vat != null && <span className="tabular-nums">세액 {d.vat.toLocaleString("ko-KR")}</span>}
                {/* 금액이 있는 증빙이면 종류와 무관하게 지급 상태를 단다 (견적서로 바로 송금하는 건도 있어서) */}
                {(money(d) || d.kind === "거래명세표" || d.kind === "세금계산서") && (
                  <button
                    onClick={() => patch(d.id, { paid: !d.paid })}
                    disabled={busy === d.id}
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={d.paid
                      ? { color: "#3F7A57", background: "#E8F1EB" }
                      : { color: "#C2711F", background: "#FBF0E2" }}
                    title="지급 상태 전환"
                  >
                    {d.paid ? <><Check size={10} /> 지급완료</> : "미지급"}
                  </button>
                )}
              </div>
              {d.items && d.items.length > 0 && (
                <div className="pl-[22px] mt-0.5 text-[11px] text-[#9A968E] truncate">
                  {d.items.map((it) => `${it.name}${it.qty ? ` ${it.qty}` : ""}`).join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 미수령 슬롯 — 눌러서 바로 첨부 */}
      {missing.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {missing.map((k) => (
            <button
              key={k}
              onClick={() => pick(k)}
              disabled={busy === "upload"}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-[#D8D4CC] text-[12px] text-[#9A968E] hover:border-[#B8B4AC] hover:text-[#6B6863] transition-colors disabled:opacity-50"
            >
              <Paperclip size={13} /> {k}
              <span className="ml-auto text-[10px] text-[#C9C5BD]">첨부</span>
            </button>
          ))}
        </div>
      )}

      {err && <div className="mt-2 text-[11.5px]" style={{ color: "#B4472E" }}>{err}</div>}
      <p className="mt-2 text-[11px] text-[#9A968E] leading-relaxed">
        사진·PDF·엑셀 30MB까지. 파쇼 거래명세표는 텔레그램에 사진을 보내면 판독 후 승인 시 여기에 자동으로 쌓입니다.
      </p>
    </div>
  );
}
