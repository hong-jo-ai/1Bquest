"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { RefreshCw, Trash2, Check, AlertCircle, Upload, FileSpreadsheet, Mail } from "lucide-react";
import type { MultiChannelData } from "@/lib/multiChannelData";

interface UploadMeta {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
}

interface Props {
  channelName: string;
  channelColor: string;
  onDataLoaded: (data: MultiChannelData, meta: UploadMeta) => void;
  onClear: () => void;
  currentMeta: UploadMeta | null;
}

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000) return Math.round(n / 10_000) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

interface SkuMapEntry {
  kakaoSku:    string;
  optionText?: string;
  kakaoName?:  string;
  cafe24Code:  string;
}

export default function KakaoGiftSyncPanel({
  channelName, channelColor, onDataLoaded, onClear, currentMeta,
}: Props) {
  // ── SKU 매핑 (재고 차감용) ──────────────────────────────────────────
  const [skuMap, setSkuMap] = useState<SkuMapEntry[]>([]);
  const [skuMapDirty, setSkuMapDirty] = useState(false);
  const [skuMapSaving, setSkuMapSaving] = useState(false);

  const loadSkuMap = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/kakao-gift-sku-map", { cache: "no-store" });
      const j = await res.json();
      if (j.ok) {
        setSkuMap(j.mappings ?? []);
        setSkuMapDirty(false);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSkuMap(); }, [loadSkuMap]);

  const updateMapEntry = (idx: number, patch: Partial<SkuMapEntry>) => {
    setSkuMap((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
    setSkuMapDirty(true);
  };
  const addMapEntry = () => {
    setSkuMap((prev) => [...prev, { kakaoSku: "", optionText: "", kakaoName: "", cafe24Code: "" }]);
    setSkuMapDirty(true);
  };
  const removeMapEntry = (idx: number) => {
    setSkuMap((prev) => prev.filter((_, i) => i !== idx));
    setSkuMapDirty(true);
  };
  const saveSkuMap = async () => {
    setSkuMapSaving(true);
    try {
      const res = await fetch("/api/finance/kakao-gift-sku-map", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mappings: skuMap }),
      });
      const j = await res.json();
      if (j.ok) {
        setSkuMapDirty(false);
        loadSkuMap();
      }
    } catch { /* ignore */ }
    finally { setSkuMapSaving(false); }
  };

  // ── Gmail 일일 발주서 동기화 ──────────────────────────────────────────
  const [poStatus, setPoStatus] = useState<{
    syncedAt?: string;
    triggeredBy?: string;
    processed?: number;
    totalAttachments?: number;
    poDates?: string[];
    errorCount?: number;
    errors?: Array<{ messageId: string; error: string }>;
  } | null>(null);
  const [poSyncing, setPoSyncing] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);

  const loadPoStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/kakao-gift-po-sync", { cache: "no-store" });
      const j = await res.json();
      if (j.ok) setPoStatus(j.status);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadPoStatus(); }, [loadPoStatus]);

  const triggerPoSync = async () => {
    setPoSyncing(true);
    setPoError(null);
    try {
      const res = await fetch("/api/finance/kakao-gift-po-sync", { method: "POST" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "동기화 실패");
      await loadPoStatus();
    } catch (e) {
      setPoError(e instanceof Error ? e.message : String(e));
    } finally {
      setPoSyncing(false);
    }
  };

  // ── 정산서 업로드 ─────────────────────────────────────────────────────
  const settleFileRef = useRef<HTMLInputElement>(null);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settleResult, setSettleResult] = useState<{
    year: number;
    month: number;
    totalRevenue: number;
    totalSold: number;
    productCount: number;
    settlementCount: number;
  } | null>(null);

  const uploadSettlement = async (file: File) => {
    setSettling(true);
    setSettleError(null);
    setSettleResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/finance/kakao-gift-settlement/upload", {
        method: "POST",
        body: fd,
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error(`서버 응답 오류 (HTTP ${res.status})`);
      }
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "정산서 처리 실패");
      setSettleResult({
        year: j.year,
        month: j.month,
        totalRevenue: j.totalRevenue,
        totalSold: j.totalSold,
        productCount: j.productCount,
        settlementCount: j.settlementCount,
      });
      if (j.data && j.meta) onDataLoaded(j.data, j.meta);
    } catch (e: any) {
      setSettleError(e.message ?? "정산서 처리 실패");
    } finally {
      setSettling(false);
      if (settleFileRef.current) settleFileRef.current.value = "";
    }
  };

  return (
    <div
      className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5 min-w-0"
      style={{ borderLeft: `4px solid ${channelColor}` }}
    >
      {/* ── Gmail 일일 발주서 자동 동기화 (신규 v3) ─────────────────────── */}
      <div className="mb-5 pb-5 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-2">
          <Mail size={16} style={{ color: channelColor }} />
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            Gmail 일일 발주서 자동 동기화
          </h3>
          <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">자동</span>
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-3">
          매일 오후 3시(KST) 자동 — <b>plvekorea@gmail.com</b> 의 song@fjord.kr 발주서 메일
          첨부 엑셀을 파싱해 일별 매출에 반영. 처리된 메일은 &lsquo;카카오선물_처리완료&rsquo; 라벨로
          중복 방지.
        </p>

        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button
            onClick={triggerPoSync}
            disabled={poSyncing}
            className="inline-flex items-center gap-2 px-3 h-9 rounded-lg text-xs font-semibold text-white shadow-sm disabled:opacity-50"
            style={{ backgroundColor: channelColor }}
          >
            <RefreshCw size={12} className={poSyncing ? "animate-spin" : ""} />
            {poSyncing ? "동기화 중…" : "지금 동기화"}
          </button>
          {poStatus?.syncedAt && (
            <span className="text-[11px] text-zinc-500">
              마지막 동기화: {new Date(poStatus.syncedAt).toLocaleString("ko-KR")}
              {poStatus.triggeredBy === "cron" ? " (자동)" : " (수동)"}
            </span>
          )}
        </div>

        {poStatus && (poStatus.processed ?? 0) > 0 && (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
            메일 {poStatus.processed}통 처리 · 발주서 {poStatus.totalAttachments}건
            {poStatus.poDates && poStatus.poDates.length > 0 && (
              <> · {poStatus.poDates.slice(-3).join(", ")}{poStatus.poDates.length > 3 ? "…" : ""}</>
            )}
          </p>
        )}
        {poStatus && (poStatus.processed ?? 0) === 0 && poStatus.syncedAt && (
          <p className="text-[11px] text-zinc-400">새 발주서 메일 없음</p>
        )}
        {(poStatus?.errorCount ?? 0) > 0 && (
          <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded p-2">
            <p className="font-semibold">처리 중 오류 {poStatus?.errorCount}건</p>
            {poStatus?.errors?.slice(0, 3).map((e, i) => (
              <p key={i} className="opacity-80 mt-0.5 truncate">{e.messageId}: {e.error}</p>
            ))}
          </div>
        )}
        {poError && (
          <div className="mt-2 flex items-start gap-2 text-[11px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded p-2">
            <AlertCircle size={11} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="break-words">{poError}</p>
              {(poError.includes("미연결") ||
                poError.includes("스코프") ||
                poError.includes("insufficient") ||
                poError.includes("403")) && (
                <a
                  href="/api/auth/kakao-gift-gmail/login"
                  className="underline font-semibold mt-1 inline-block"
                >
                  plvekorea@gmail.com 으로 Gmail 연결 →
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {currentMeta && (
        <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-2">
          <span>
            마지막 머지: {new Date(currentMeta.uploadedAt).toLocaleString("ko-KR")} ·
            {" "}{currentMeta.rowCount}개 상품
          </span>
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-rose-500"
            title="저장된 데이터 삭제"
          >
            <Trash2 size={11} />
            삭제
          </button>
        </div>
      )}

      {/* ── SKU 매핑 (재고 차감용) ─────────────────────────────────────── */}
      <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-2">
          <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            SKU 매핑 (재고 차감용)
          </h4>
          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">선택</span>
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-3">
          카카오 sku → 본 SKU 코드(P00000XX) 매핑. <b>시계처럼 부모 SKU 가 색상별로
          분기되는 경우</b> 옵션명 컬럼에 색상(예: &lsquo;화이트 브라운&rsquo;) 입력 — 발주서 옵션과 매칭됩니다.
          매핑 없는 카카오 sku 는 차감 대상에서 제외 (오매칭 방지).
        </p>

        <ul className="space-y-1.5 mb-2">
          {skuMap.map((m, idx) => (
            <li key={idx} className="flex items-center gap-1.5">
              <input
                value={m.kakaoSku}
                onChange={(e) => updateMapEntry(idx, { kakaoSku: e.target.value })}
                placeholder="카카오 sku"
                className="w-24 min-w-0 text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 tabular-nums"
              />
              <input
                value={m.kakaoName ?? ""}
                onChange={(e) => updateMapEntry(idx, { kakaoName: e.target.value })}
                placeholder="상품명 (PO 매칭용)"
                className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
              />
              <input
                value={m.optionText ?? ""}
                onChange={(e) => updateMapEntry(idx, { optionText: e.target.value })}
                placeholder="옵션 (시계만)"
                className="w-28 text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200"
              />
              <span className="text-[10px] text-zinc-400 shrink-0">→</span>
              <input
                value={m.cafe24Code}
                onChange={(e) => updateMapEntry(idx, { cafe24Code: e.target.value })}
                placeholder="P00000XX"
                className="w-24 text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 tabular-nums"
              />
              <button
                onClick={() => removeMapEntry(idx)}
                className="text-zinc-400 hover:text-rose-500 shrink-0"
                aria-label="삭제"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {skuMap.length === 0 && (
            <p className="text-[11px] text-zinc-400 italic">매핑이 없습니다 — 정산서 발행 후 sku 확인하고 추가하세요.</p>
          )}
        </ul>

        <div className="flex items-center gap-2">
          <button
            onClick={addMapEntry}
            className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700"
          >
            + 매핑 추가
          </button>
          {skuMapDirty && (
            <button
              onClick={saveSkuMap}
              disabled={skuMapSaving}
              className="text-[11px] font-semibold bg-violet-600 hover:bg-violet-700 text-white px-2.5 py-1 rounded disabled:opacity-50"
            >
              {skuMapSaving ? "저장 중…" : "저장"}
            </button>
          )}
          {!skuMapDirty && skuMap.length > 0 && (
            <span className="text-[10px] text-emerald-600">{skuMap.length}건 저장됨</span>
          )}
        </div>
      </div>

      {/* ── 월별 정산서 업로드 ───────────────────────────────────────────── */}
      <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-2">
          <FileSpreadsheet size={14} style={{ color: channelColor }} />
          <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            월별 정산서 업로드
          </h4>
        </div>
        <p className="text-[11px] text-zinc-500 mb-3">
          피오르드가 매월 발행하는 정산서 .xlsx를 업로드하세요. 그 달의 매출/수수료가
          정산서 기준으로 정확하게 반영됩니다 (수수료 통합 30% 자동 차감).
          파일명에 "N월"이 포함되어야 정산 대상 월을 자동 인식.
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => settleFileRef.current?.click()}
            disabled={settling}
            className="inline-flex items-center gap-2 px-4 h-10 rounded-xl text-sm font-semibold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
          >
            <Upload size={13} />
            {settling ? "처리 중…" : "정산서 파일 선택"}
          </button>
          <input
            ref={settleFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadSettlement(f);
            }}
          />
        </div>

        {settleError && (
          <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 rounded-lg p-3 mt-3">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <p className="break-keep">{settleError}</p>
          </div>
        )}

        {settleResult && (
          <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 mt-3">
            <Check size={13} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium">
                {settleResult.year}년 {settleResult.month}월 정산서 반영 완료
              </p>
              <p className="opacity-80 mt-0.5">
                상품 {settleResult.productCount}개 · 판매 {settleResult.totalSold}건 ·
                총매출 {fmtKRW(settleResult.totalRevenue)} ·
                전체 누적 정산서 {settleResult.settlementCount}개월
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
