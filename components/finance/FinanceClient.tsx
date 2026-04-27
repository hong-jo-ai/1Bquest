"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, RefreshCw, ChevronDown, FileSpreadsheet } from "lucide-react";
import { CATEGORY_COLOR, type TxCategory } from "@/lib/finance/categorize";

interface BankTx {
  id: string;
  bank: string;
  tx_date: string;
  description: string;
  counterparty: string;
  memo: string;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  category: TxCategory | null;
  category_source: string | null;
}

interface AggEntry { withdrawal: number; deposit: number; count: number }

const CATEGORIES: TxCategory[] = [
  "매출", "광고비", "매입", "인건비", "임대료", "통신비",
  "소프트웨어", "택배비", "수수료", "세금",
  "카드결제", "식비", "교통/연료", "송금", "기타",
];

function fmtKrw(n: number): string {
  return `₩${Math.round(n).toLocaleString("ko-KR")}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function FinanceClient() {
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [aggregate, setAggregate] = useState<Record<string, AggEntry>>({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | TxCategory>("all");
  const loadTxs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("category", filter);
      const res = await fetch(`/api/finance/bank-tx?${params}`);
      const j = await res.json();
      if (j.ok) {
        setTxs(j.transactions);
        setAggregate(j.aggregate);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { loadTxs(); }, [loadTxs]);

  const totals = useMemo(() => {
    let inflow = 0, outflow = 0;
    for (const c of Object.values(aggregate)) {
      inflow += c.deposit;
      outflow += c.withdrawal;
    }
    return { inflow, outflow, net: inflow - outflow };
  }, [aggregate]);

  return (
    <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            재무 관리
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            은행 거래내역 업로드 + 자동 분류 — 어디에 돈을 쓰고 어디서 돈이 들어오는지 한눈에
          </p>
        </div>
        <button
          onClick={loadTxs}
          className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
          title="새로고침"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* 업로드 */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <UploadCard
          title="KB국민은행 거래내역"
          hint="인터넷뱅킹 → 거래내역 → 엑셀"
          accept=".xls,.xlsx,.csv"
          uploadUrl="/api/finance/bank-tx?bank=KB"
          onSuccess={(j) => `${j.parsed}건 → ${j.inserted}건 신규 (${j.skipped}건 중복)`}
          onDone={loadTxs}
        />
        <UploadCard
          title="현대카드 이용내역"
          hint="현대카드 → 이용내역 → 엑셀 다운로드"
          accept=".xls,.xlsx"
          uploadUrl="/api/finance/card-usage?source=card_hyundai"
          onSuccess={(j) => `${j.parsed}건 → ${j.inserted}건 신규 (${j.skipped}건 중복)`}
        />
        <UploadCard
          title="KB국민카드 이용내역"
          hint="KB국민카드 → 이용내역 → 엑셀 다운로드"
          accept=".xls,.xlsx"
          uploadUrl="/api/finance/card-usage?source=card_kb"
          onSuccess={(j) => `${j.parsed}건 → ${j.inserted}건 신규 (${j.skipped}건 중복)`}
        />
        <UploadCard
          title="네이버페이 영수증"
          hint="네이버페이 → 결제내역 → 엑셀 다운로드"
          accept=".xls,.xlsx"
          uploadUrl="/api/finance/card-usage?source=npay"
          onSuccess={(j) => `${j.parsed}건 → ${j.inserted}건 신규 (${j.skipped}건 중복)`}
        />
        <UploadCard
          title="홈택스 매입세금계산서"
          hint="전자세금계산서 → 매입 → 다운로드"
          accept=".xls,.xlsx"
          uploadUrl="/api/finance/tax-invoices?type=purchase"
          onSuccess={(j) =>
            `${j.invoicesUpserted}건 (${j.itemsInserted}품목) · ₩${(j.totalAmount ?? 0).toLocaleString()}`
          }
        />
        <UploadCard
          title="홈택스 매출세금계산서"
          hint="전자세금계산서 → 매출 → 다운로드"
          accept=".xls,.xlsx"
          uploadUrl="/api/finance/tax-invoices?type=sales"
          onSuccess={(j) =>
            `${j.invoicesUpserted}건 · ₩${(j.totalAmount ?? 0).toLocaleString()}`
          }
        />
        <UploadCard
          title="W컨셉 광고 일별 리포트"
          hint="W컨셉 광고센터 → 일별 성과 → CSV 다운로드"
          accept=".csv"
          uploadUrl="/api/finance/ad-spend?source=wconcept"
          onSuccess={(j) =>
            `${j.parsed}일치 (신규 ${j.inserted} / 갱신 ${j.updated}) — 누적 ${j.total}일`
          }
        />
      </section>

      {/* 요약 카드 */}
      <section className="grid grid-cols-3 gap-3 sm:gap-4">
        <SummaryCard label="입금 (전체)" value={fmtKrw(totals.inflow)} accent="emerald" />
        <SummaryCard label="출금 (전체)" value={fmtKrw(totals.outflow)} accent="red" />
        <SummaryCard
          label="순현금흐름"
          value={fmtKrw(totals.net)}
          accent={totals.net >= 0 ? "emerald" : "red"}
        />
      </section>

      {/* 카테고리별 집계 */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 sm:p-6">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-3">
          카테고리별 (전체 기간 합산)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {CATEGORIES.map((cat) => {
            const a = aggregate[cat] ?? { withdrawal: 0, deposit: 0, count: 0 };
            const net = a.deposit - a.withdrawal;
            if (a.count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat === filter ? "all" : cat)}
                className={`text-left p-3 rounded-xl border transition ${
                  filter === cat
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10"
                    : "border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[cat] }} />
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    {cat}
                  </span>
                  <span className="text-[10px] text-zinc-400 ml-auto">{a.count}건</span>
                </div>
                <div className={`text-sm font-bold tabular-nums ${
                  net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                }`}>
                  {net >= 0 ? "+" : ""}{fmtKrw(Math.abs(net)).replace("₩", net < 0 ? "-₩" : "₩")}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  입 {fmtKrw(a.deposit)} / 출 {fmtKrw(a.withdrawal)}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 거래 목록 */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
        <div className="px-4 sm:px-6 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              거래내역 {filter !== "all" && `· ${filter}`}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{txs.length}건 표시</div>
          </div>
          {filter !== "all" && (
            <button
              onClick={() => setFilter("all")}
              className="text-xs text-zinc-500 hover:text-zinc-700"
            >
              필터 해제
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-950/50 border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap">날짜</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap">거래처</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap">적요</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 whitespace-nowrap">출금</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 whitespace-nowrap">입금</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap">분류</th>
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-400">
                    {loading ? "로딩 중…" : "거래내역이 없습니다. 위에서 KB 엑셀 파일을 업로드하세요."}
                  </td>
                </tr>
              ) : (
                txs.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                  >
                    <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
                      {fmtDate(t.tx_date)}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-800 dark:text-zinc-200 max-w-[200px] truncate">
                      {t.counterparty || "-"}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-zinc-500 whitespace-nowrap">
                      {t.description || "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-red-600 dark:text-red-400 tabular-nums whitespace-nowrap">
                      {t.withdrawal > 0 ? `-${fmtKrw(t.withdrawal)}` : "-"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                      {t.deposit > 0 ? `+${fmtKrw(t.deposit)}` : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <CategoryPicker
                        txId={t.id}
                        current={t.category}
                        onChange={(newCat) => {
                          setTxs((prev) =>
                            prev.map((x) => (x.id === t.id ? { ...x, category: newCat } : x))
                          );
                        }}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function UploadCard({
  title,
  hint,
  accept,
  uploadUrl,
  onSuccess,
  onDone,
}: {
  title: string;
  hint: string;
  accept: string;
  uploadUrl: string;
  onSuccess: (json: Record<string, unknown> & { [key: string]: any }) => string;
  onDone?: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handle = async (file: File) => {
    setUploading(true);
    setStatus(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(uploadUrl, { method: "POST", body: formData });
      const j = await res.json();
      if (res.ok && j.ok !== false) {
        setStatus({ type: "ok", msg: onSuccess(j) });
        onDone?.();
      } else {
        setStatus({ type: "err", msg: j.error ?? "업로드 실패" });
      }
    } catch (e) {
      setStatus({ type: "err", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <FileSpreadsheet size={16} className="text-zinc-400 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">{hint}</div>
        </div>
      </div>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center justify-center gap-1.5 px-3 h-8 rounded-lg text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
      >
        <Upload size={12} />
        {uploading ? "처리 중…" : "파일 선택"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      {status && (
        <div
          className={`text-[11px] px-2 py-1.5 rounded-md ${
            status.type === "ok"
              ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
              : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
          }`}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label, value, accent,
}: {
  label: string;
  value: string;
  accent: "emerald" | "red";
}) {
  const color =
    accent === "emerald"
      ? "from-emerald-500 to-teal-600"
      : "from-red-500 to-rose-600";
  return (
    <div className={`bg-gradient-to-br ${color} rounded-2xl p-4 sm:p-5 text-white shadow-md`}>
      <div className="text-[11px] sm:text-xs font-semibold opacity-90">{label}</div>
      <div className="text-lg sm:text-2xl font-bold mt-1 tabular-nums leading-tight">{value}</div>
    </div>
  );
}

function CategoryPicker({
  txId,
  current,
  onChange,
}: {
  txId: string;
  current: TxCategory | null;
  onChange: (cat: TxCategory) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const cur = current ?? "기타";

  const handle = async (cat: TxCategory) => {
    setOpen(false);
    if (cat === current) return;
    setSaving(true);
    try {
      const res = await fetch("/api/finance/bank-tx", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: txId, category: cat }),
      });
      if (res.ok) onChange(cat);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={saving}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
        style={{ color: CATEGORY_COLOR[cur as TxCategory] }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[cur as TxCategory] }} />
        {cur}
        <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-50 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 py-1 min-w-[120px]">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => handle(cat)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                  cat === cur ? "font-semibold bg-zinc-50 dark:bg-zinc-800/50" : ""
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[cat] }} />
                {cat}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
