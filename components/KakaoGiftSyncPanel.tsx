"use client";

import { useRef, useState } from "react";
import { Cloud, RefreshCw, Trash2, Check, AlertCircle, Upload, FileSpreadsheet } from "lucide-react";
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

export default function KakaoGiftSyncPanel({
  channelName, channelColor, onDataLoaded, onClear, currentMeta,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sheetName: string;
    rowCount: number;
    totalRevenue: number;
    totalSold: number;
    monthsWithData: number;
  } | null>(null);

  const sync = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/finance/kakao-gift-sheet/sync");
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error(`서버 응답 오류 (HTTP ${res.status})`);
      }
      const j = await res.json();
      if (!j.ok) {
        throw new Error(j.error ?? "동기화 실패");
      }
      setResult({
        sheetName: j.sheetName,
        rowCount: j.rowCount,
        totalRevenue: j.totalRevenue,
        totalSold: j.totalSold,
        monthsWithData: j.monthsWithData,
      });
      if (j.data && j.meta) onDataLoaded(j.data, j.meta);
    } catch (e: any) {
      setError(e.message ?? "동기화 실패");
    } finally {
      setLoading(false);
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
      <div className="flex items-center gap-2 mb-3">
        <Cloud size={18} style={{ color: channelColor }} />
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
          {channelName} 구글시트 동기화
        </h3>
      </div>

      <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mb-4">
        매월 정산 시트가 갱신되면 아래 버튼을 한 번 누르면 자동으로 최신
        데이터를 가져옵니다. 시트 형식: 카카오코드 / 상품명 / 총합계 / 1~12월(판매수량·매출).
      </p>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={sync}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 h-10 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          style={{ backgroundColor: channelColor }}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {loading ? "동기화 중…" : currentMeta ? "다시 동기화" : "구글시트에서 가져오기"}
        </button>
        {currentMeta && (
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1.5 px-3 h-10 rounded-xl text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="저장된 데이터 삭제"
          >
            <Trash2 size={13} />
            데이터 삭제
          </button>
        )}
      </div>

      {/* 결과 */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 rounded-lg p-3">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium">동기화 실패</p>
            <p className="opacity-80 mt-0.5 break-keep">{error}</p>
            {error.includes("Google 미연결") && (
              <a
                href="/api/auth/google/login"
                className="inline-block mt-1 text-red-700 dark:text-red-300 underline font-semibold"
              >
                Google 재로그인 →
              </a>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3">
          <Check size={13} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium">동기화 완료 — {result.sheetName}</p>
            <p className="opacity-80 mt-0.5">
              상품 {result.rowCount}개 · 데이터 있는 월 {result.monthsWithData}개월 ·
              총 판매 {result.totalSold.toLocaleString("ko-KR")}건 ·
              총 매출 {fmtKRW(result.totalRevenue)}
            </p>
          </div>
        </div>
      )}

      {currentMeta && !result && !error && (
        <div className="text-[11px] text-zinc-400 mt-2">
          마지막 동기화: {new Date(currentMeta.uploadedAt).toLocaleString("ko-KR")} ·
          {" "}{currentMeta.rowCount}개 상품
        </div>
      )}

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
