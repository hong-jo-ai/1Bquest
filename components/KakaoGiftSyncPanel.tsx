"use client";

import { useState } from "react";
import { Cloud, RefreshCw, Trash2, Check, AlertCircle } from "lucide-react";
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
    </div>
  );
}
