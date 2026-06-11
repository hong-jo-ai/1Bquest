"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Package,
  Truck,
  RefreshCw,
  Send,
  ExternalLink,
  Loader2,
  AlertCircle,
  Undo2,
  FlaskConical,
  Plus,
  X,
  FileUp,
  CheckCircle2,
} from "lucide-react";

interface TrackScan {
  date?: string;
  status?: string;
  location?: string;
}
interface TrackResult {
  rgist: string;
  found: boolean;
  state?: string;
  senderName?: string;
  receiverName?: string;
  scans: TrackScan[];
  error?: string;
}

interface Shipment {
  id: string;
  order_number: string;
  channel: string;
  req_type: "1" | "2";
  recipient_name: string | null;
  recipient_addr: string | null;
  recipient_zip: string | null;
  product_name: string | null;
  qty: number | null;
  regi_no: string | null;
  price: string | null;
  is_test: boolean;
  status: string;
  tracking_state: string | null;
  tracking_checked_at: string | null;
  error_code: string | null;
  error_message: string | null;
  registered_at: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "준비",
  submitted: "접수완료",
  printed: "운송장출력",
  collected: "집하완료",
  cancelled: "취소됨",
  error: "오류",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-slate-400 text-white",
  submitted: "bg-sky-500 text-white",
  printed: "bg-violet-500 text-white",
  collected: "bg-emerald-500 text-white",
  cancelled: "bg-slate-500 text-white",
  error: "bg-rose-500 text-white",
};

// 종추적 상태 배지: 배달완료는 초록 ✓로 한눈에, 배달준비/출발은 옅은 앰버
function isDelivered(state?: string | null): boolean {
  return !!state && state.includes("배달완료");
}
function TrackingBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-slate-400">—</span>;
  if (isDelivered(state)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {state}
      </span>
    );
  }
  const outForDelivery = state.includes("배달준비") || state.includes("배달출발");
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        outForDelivery ? "bg-amber-100 text-amber-700" : "text-slate-600"
      }`}
    >
      {state}
    </span>
  );
}

// 접수일시 — KST "MM/DD HH:mm" (없으면 —)
function fmtRegAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

const BIZ_EPOST_PRINT = "https://biz.epost.go.kr/ui/index.jsp";

// 판매처별 아주 옅은 행 배경 (구분용 · 과하지 않게 50/70)
const CHANNEL_TINT: Record<string, string> = {
  "카페24": "bg-sky-50/70",
  "W컨셉": "bg-rose-50/70",
  "29CM": "bg-violet-50/70",
  "식스샵": "bg-amber-50/70",
  "무신사": "bg-lime-50/70",
  "식스샵글로벌": "bg-amber-50/40",
  AS: "bg-teal-50/70",
  influencer: "bg-fuchsia-50/70",
  엑셀: "bg-slate-50",
  manual: "bg-slate-50",
  반품: "bg-orange-50/70",
};

/**
 * 접수 큐 job 폴링 — POST 로 적재한 jobId 를 GET 으로 done/error 까지 폴링.
 * 접수는 iMac 워커가 처리하므로 결과가 즉시 오지 않는다.
 */
async function pollRegisterJob(
  base: string,
  jobId: string,
  timeoutMs = 120000
): Promise<{ status: string; result?: Record<string, unknown> | null; error?: string | null }> {
  const start = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`${base}?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = await res.json();
      if (data.job && (data.job.status === "done" || data.job.status === "error")) return data.job;
    } catch {
      /* 일시적 네트워크 오류는 무시하고 계속 폴링 */
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("접수 처리 시간 초과 — iMac 접수 워커 실행 여부를 확인하세요");
    }
  }
}

export default function ShippingClient() {
  const [tab, setTab] = useState<"1" | "2">("1");
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSingle, setShowSingle] = useState(false);
  const [query, setQuery] = useState("");
  // 등기번호 직접 조회 (과거/수기 발송 포함)
  const [trackNo, setTrackNo] = useState("");
  const [trackBusy, setTrackBusy] = useState(false);
  const [trackResult, setTrackResult] = useState<TrackResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 검색어가 있으면 보관분(1주일 이전) 포함 전체를 서버에서 조회, 없으면 최근 1주일만.
      const qs = new URLSearchParams({ reqType: tab });
      const term = query.trim();
      if (term) qs.set("q", term);
      const res = await fetch(`/api/postparcel/shipments?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "조회 실패");
      setShipments(data.shipments || []);
      setCounts(data.counts || {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab, query]);

  // 검색어 변경은 디바운스(타이핑 중 과도한 서버 호출 방지). 탭 전환·초기화는 즉시.
  useEffect(() => {
    const t = setTimeout(() => { load(); }, query.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  // 로컬에이전트 호출 (출고 일괄 접수)
  async function registerOutbound() {
    setBusy("register");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/postparcel/register-outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "출고 일괄 접수 실패");
      setNotice("출고 일괄 접수 요청 — 처리 중…");
      const job = await pollRegisterJob("/api/postparcel/register-outbound", data.jobId);
      if (job.status === "error") throw new Error(job.error || "출고 일괄 접수 실패");
      const r = (job.result ?? {}) as { ok?: number; skipped?: number; failed?: number };
      setNotice(`접수 완료 — 성공 ${r.ok ?? 0} / 스킵 ${r.skipped ?? 0} / 실패 ${r.failed ?? 0}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // 종추적조회 갱신
  async function refreshTracking() {
    setBusy("track");
    setError(null);
    try {
      const res = await fetch("/api/postparcel/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "track" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "배송조회 실패");
      setNotice(`배송조회 ${data.checked}건 갱신`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // 엑셀 파일 접수
  const fileRef = useRef<HTMLInputElement>(null);
  async function uploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!f) return;
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/postparcel/register-batch", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "엑셀 접수 실패");
      setNotice(`엑셀 ${data.parsedRows ?? "?"}행 접수 요청 — 처리 중…`);
      const job = await pollRegisterJob("/api/postparcel/register-batch", data.jobId);
      if (job.status === "error") throw new Error(job.error || "엑셀 접수 실패");
      const r = (job.result ?? {}) as { ok?: number; skipped?: number; failed?: number };
      setNotice(`엑셀 접수 완료 — ${data.parsedRows ?? "?"}행 → 성공 ${r.ok ?? 0} / 스킵 ${r.skipped ?? 0} / 실패 ${r.failed ?? 0}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // 등기번호 직접 배송조회
  async function trackByNumber() {
    const n = trackNo.replace(/\D/g, "");
    if (!n) return;
    setTrackBusy(true);
    setTrackResult(null);
    try {
      const res = await fetch(`/api/postparcel/track?rgist=${n}`, { cache: "no-store" });
      setTrackResult(await res.json());
    } catch (e) {
      setTrackResult({ rgist: n, found: false, scans: [], error: (e as Error).message });
    } finally {
      setTrackBusy(false);
    }
  }

  // 원클릭 반품 접수
  async function registerReturn(s: Shipment) {
    if (!confirm(`${s.order_number} 반품 접수할까요?`)) return;
    setBusy(`return-${s.id}`);
    setError(null);
    try {
      const res = await fetch("/api/postparcel/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: s.order_number,
          seller: s.channel,
          name: s.recipient_name,
          addr: s.recipient_addr,
          zip: s.recipient_zip,
          prod: s.product_name,
          qty: s.qty,
          retOrigRegiNo: s.regi_no,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "반품 접수 실패");
      setNotice("반품 접수 요청 — 처리 중…");
      const job = await pollRegisterJob("/api/postparcel/return", data.jobId);
      if (job.status === "error") throw new Error(job.error || "반품 접수 실패");
      const r = (job.result ?? {}) as { regiNo?: string };
      setNotice(`반품 접수 완료 → ${r.regiNo ?? ""}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const hasTest = shipments.some((s) => s.is_test);

  // 검색은 서버가 처리(기본 1주일 / 검색 시 보관 포함 전체). 클라이언트는 즉시 반응용 텍스트 필터만.
  const filtered = shipments.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [s.recipient_name, s.order_number, s.regi_no, s.product_name, s.channel]
      .some((v) => String(v || "").toLowerCase().includes(q));
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* 헤더 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-sky-600" />
          <h1 className="text-xl font-bold text-slate-800">우체국 발송</h1>
          {hasTest && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              <FlaskConical className="h-3 w-3" /> 테스트 모드
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowSingle(true)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-600 bg-white px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            단건 접수
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={uploadExcel}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            title="우체국송장양식 엑셀(수취인명·주소·우편번호·상품명·주문번호·판매처 등)을 올려 일괄 접수"
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-600 bg-white px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
          >
            {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            엑셀 파일 접수
          </button>
          <button
            onClick={registerOutbound}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy === "register" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            출고 일괄 접수
          </button>
          <button
            onClick={refreshTracking}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "track" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            배송조회 갱신
          </button>
          <a
            href={BIZ_EPOST_PRINT}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="h-4 w-4" /> biz.epost 운송장 출력
          </a>
        </div>
      </div>

      {/* 탭 */}
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {([
          ["1", "출고", Truck],
          ["2", "반품", Undo2],
        ] as const).map(([v, label, Icon]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-semibold ${
              tab === v ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {/* 알림 */}
      {notice && (
        <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>
      )}
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* 상태 요약 */}
      <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-500">
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5">
            {STATUS_LABEL[k] || k} {v}
          </span>
        ))}
      </div>

      {/* 검색 / 기간 필터 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="수취인 · 주문번호 · 운송장 · 상품 검색"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <span className="text-xs text-slate-400">
          {query.trim()
            ? `검색결과 ${filtered.length}건 · 보관분 포함`
            : `최근 1주일 ${filtered.length}건 · 이전 발송은 검색으로 조회`}
        </span>
      </div>

      {/* 등기번호 직접 배송조회 (과거/수기 발송 포함) */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">등기번호 배송조회</span>
          <input
            value={trackNo}
            onChange={(e) => setTrackNo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && trackByNumber()}
            placeholder="등기번호 13자리 (시스템에 없는 과거 발송도 조회)"
            inputMode="numeric"
            className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button
            onClick={trackByNumber}
            disabled={trackBusy || !trackNo.replace(/\D/g, "")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {trackBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            조회
          </button>
        </div>
        {trackResult && (
          <div className="mt-2 text-sm">
            {trackResult.found ? (
              <>
                <div className="mb-1 text-slate-700">
                  <span className="font-semibold">{trackResult.state || "조회됨"}</span>
                  {trackResult.receiverName && <span className="text-slate-500"> · 받는분 {trackResult.receiverName}</span>}
                  <span className="text-xs text-slate-400"> · {trackResult.rgist}</span>
                </div>
                <ol className="space-y-0.5">
                  {trackResult.scans.map((s, i) => (
                    <li key={i} className="text-xs text-slate-600">
                      <span className="text-slate-400">{s.date}</span> {s.location} — {s.status}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <div className="text-xs text-slate-500">{trackResult.error || "조회 결과가 없습니다."}</div>
            )}
          </div>
        )}
      </div>

      {/* 목록 */}
      {/* 데스크탑: 표 */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-3 py-2 font-medium">판매처</th>
              <th className="px-3 py-2 font-medium">주문번호</th>
              <th className="px-3 py-2 font-medium">접수일</th>
              <th className="px-3 py-2 font-medium">수취인</th>
              <th className="px-3 py-2 font-medium">상품</th>
              <th className="px-3 py-2 font-medium">운송장번호</th>
              <th className="px-3 py-2 font-medium">상태</th>
              <th className="px-3 py-2 font-medium">배송상태</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-slate-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-slate-400">
                  {shipments.length === 0
                    ? `접수 내역이 없습니다. ${tab === "1" ? "‘출고 일괄 접수’ 또는 ‘단건 접수’로 등록하세요." : ""}`
                    : "검색 결과가 없습니다."}
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.id} className={`border-b border-slate-100 last:border-0 ${isDelivered(s.tracking_state) ? "bg-emerald-50" : CHANNEL_TINT[s.channel] || ""}`}>
                  <td className="px-3 py-2 text-slate-600">{s.channel}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{s.order_number}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{fmtRegAt(s.registered_at)}</td>
                  <td className="px-3 py-2 text-slate-700">{s.recipient_name}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-slate-600" title={s.product_name || ""}>
                    {s.product_name}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {s.regi_no === "TESTREGINOAPI" ? (
                      <span className="text-amber-600">테스트</span>
                    ) : (
                      s.regi_no || "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status] || "bg-slate-300"}`}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                    {s.error_message && (
                      <div className="mt-0.5 text-xs text-rose-500" title={s.error_message}>
                        {s.error_code}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <TrackingBadge state={s.tracking_state} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {tab === "1" && s.status !== "cancelled" && s.regi_no && (
                      <button
                        onClick={() => registerReturn(s)}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {busy === `return-${s.id}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Undo2 className="h-3 w-3" />
                        )}
                        반품
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 모바일: 카드 리스트 */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-10 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
            {shipments.length === 0
              ? `접수 내역이 없습니다.${tab === "1" ? " ‘출고 일괄 접수’ 또는 ‘단건 접수’로 등록하세요." : ""}`
              : "검색 결과가 없습니다."}
          </div>
        ) : (
          filtered.map((s) => (
            <div
              key={s.id}
              className={`rounded-xl border border-slate-200 p-3 ${isDelivered(s.tracking_state) ? "bg-emerald-50" : CHANNEL_TINT[s.channel] || "bg-white"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-xs font-medium text-slate-600">{s.channel}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status] || "bg-slate-300"}`}>
                    {STATUS_LABEL[s.status] || s.status}
                  </span>
                </div>
                <TrackingBadge state={s.tracking_state} />
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <span className="font-semibold text-slate-800">{s.recipient_name}</span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-xs text-slate-500">{s.order_number}</span>
                  <span className="block text-[11px] text-slate-400">접수 {fmtRegAt(s.registered_at)}</span>
                </span>
              </div>
              {s.product_name && <div className="mt-1 text-sm text-slate-600">{s.product_name}</div>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-500">
                  {s.regi_no === "TESTREGINOAPI" ? <span className="text-amber-600">테스트</span> : s.regi_no || "—"}
                </span>
                {tab === "1" && s.status !== "cancelled" && s.regi_no && (
                  <button
                    onClick={() => registerReturn(s)}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 active:scale-95 disabled:opacity-50"
                  >
                    {busy === `return-${s.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                    반품
                  </button>
                )}
              </div>
              {s.error_message && (
                <div className="mt-1 text-xs text-rose-500">
                  {s.error_code}: {s.error_message}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <p className="mt-4 text-xs text-slate-400">
        접수 후 송장 인쇄는 biz.epost 운송장 출력 메뉴에서 진행합니다(같은 계약 계정에 등록됨). 테스트 모드에서는 실제
        우체국에 전송되지 않고 운송장번호가 ‘TESTREGINOAPI’로 표시됩니다.
      </p>

      {showSingle && (
        <SingleRegisterModal
          onClose={() => setShowSingle(false)}
          onDone={() => {
            setNotice("단건 접수 완료");
            load();
          }}
        />
      )}
    </div>
  );
}

// ── 단건 접수 모달 (고객 요청 발송 · 임의 반품 등) ──────────────────────
function SingleRegisterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"1" | "2">("1"); // 1 출고 / 2 반품
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [tel, setTel] = useState("");
  const [zip, setZip] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [productName, setProductName] = useState("");
  const [qty, setQty] = useState("1");
  const [msg, setMsg] = useState("");
  const [ref, setRef] = useState("");
  // 반품 전용
  const [retOrigRegiNo, setRetOrigRegiNo] = useState("");
  const [retReason, setRetReason] = useState("");
  const [retVisitYmd, setRetVisitYmd] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const valid = name.trim() && address.trim() && zip.trim() && (mobile.trim() || tel.trim()) && productName.trim();

  async function submit() {
    setSubmitting(true);
    setErr(null);
    setResult(null);
    try {
      const order =
        ref.trim() ||
        `MANUAL-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;
      const body: Record<string, unknown> = {
        source: "manual",
        reqType: kind,
        order,
        name: name.trim(),
        mobile: mobile.trim(),
        tel: tel.trim(),
        zip: zip.trim(),
        addr1: address.trim(),
        addr2: addressDetail.trim(),
        prod: productName.trim(),
        qty,
        msg: msg.trim(),
      };
      if (kind === "2") {
        body.retOrigRegiNo = retOrigRegiNo.trim();
        body.retReason = retReason.trim();
        body.retVisitYmd = retVisitYmd.trim();
      }
      const res = await fetch("/api/postparcel/register-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "접수 실패");
      setResult("접수 요청 전송 — 처리 중…");
      const job = await pollRegisterJob("/api/postparcel/register-one", data.jobId);
      if (job.status === "error") throw new Error(job.error || "접수 실패");
      const r = (job.result ?? {}) as { regiNo?: string; regipoNm?: string; price?: string | number };
      const isTest = r.regiNo === "TESTREGINOAPI";
      setResult(
        `${isTest ? "[테스트] " : ""}접수 완료 — ${r.regipoNm ?? ""} ${r.price ? r.price + "원" : ""} (송장 ${r.regiNo})`
      );
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";
  const lbl = "mb-1 block text-xs font-medium text-slate-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-slate-800">단건 접수</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          {/* 구분 */}
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {([
              ["1", "출고 (일반소포)"],
              ["2", "반품 (반품소포)"],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setKind(v)}
                className={`flex-1 rounded-md py-1.5 text-sm font-semibold ${
                  kind === v ? "bg-white text-sky-700 shadow-sm" : "text-slate-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600">
                {kind === "2" ? "반품인(고객) 이름" : "받는분 이름"} <span className="text-rose-500">*</span>
              </label>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
            </div>
            <div>
              <label className={lbl}>휴대폰</label>
              <input className={field} value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="01012345678" inputMode="numeric" />
            </div>
            <div>
              <label className={lbl}>전화 (선택)</label>
              <input className={field} value={tel} onChange={(e) => setTel(e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">우편번호 <span className="text-rose-500">*</span></label>
              <input className={field} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="06234" maxLength={5} inputMode="numeric" />
            </div>
            <div>
              <label className={lbl}>수량</label>
              <input className={field} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600">주소 <span className="text-rose-500">*</span></label>
              <input className={field} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="서울 강남구 테헤란로 1" />
            </div>
            <div className="col-span-2">
              <label className={lbl}>상세주소</label>
              <input className={field} value={addressDetail} onChange={(e) => setAddressDetail(e.target.value)} placeholder="101동 1203호" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600">상품명 <span className="text-rose-500">*</span></label>
              <input className={field} value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="시계" />
            </div>
            <div className="col-span-2">
              <label className={lbl}>배송 메시지 (선택)</label>
              <input className={field} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="부재 시 경비실" />
            </div>
            <div className="col-span-2">
              <label className={lbl}>참조/주문번호 (비우면 자동생성)</label>
              <input className={field} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="MANUAL-…" />
            </div>

            {kind === "2" && (
              <>
                <div className="col-span-2">
                  <label className={lbl}>원송장(등기)번호 — 반품 대상</label>
                  <input className={field} value={retOrigRegiNo} onChange={(e) => setRetOrigRegiNo(e.target.value)} placeholder="6012345678900" inputMode="numeric" />
                </div>
                <div>
                  <label className={lbl}>반품 사유</label>
                  <input className={field} value={retReason} onChange={(e) => setRetReason(e.target.value)} placeholder="사이즈 교환" />
                </div>
                <div>
                  <label className={lbl}>방문희망일 (YYYYMMDD)</label>
                  <input className={field} value={retVisitYmd} onChange={(e) => setRetVisitYmd(e.target.value)} placeholder="비우면 내일" inputMode="numeric" />
                </div>
              </>
            )}
          </div>

          {result && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{result}</div>}
          {err && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" /> {err}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            닫기
          </button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
            {kind === "2" ? "반품 접수" : "접수"}
          </button>
        </div>
      </div>
    </div>
  );
}
