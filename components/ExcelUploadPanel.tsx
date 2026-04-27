"use client";

import { useState, useRef, useCallback } from "react";
import {
  Upload, X, CheckCircle, AlertCircle, FileSpreadsheet,
  Loader2, Trash2, Info,
} from "lucide-react";
import type { MultiChannelData } from "@/lib/multiChannelData";

interface UploadMeta {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
}

interface Props {
  channel:
    | "wconcept"
    | "musinsa"
    | "29cm"
    | "groupbuy"
    | "kakao_gift"
    | "sixshop"
    | "naver_smartstore"
    | "sixshop_global";
  channelName: string;
  channelColor: string;
  onDataLoaded: (data: MultiChannelData, meta: UploadMeta) => void;
  onClear: () => void;
  currentMeta: UploadMeta | null;
}

function fmtKRW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억원";
  if (n >= 10_000)      return Math.round(n / 10_000) + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

export default function ExcelUploadPanel({
  channel, channelName, channelColor, onDataLoaded, onClear, currentMeta,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [preview, setPreview]   = useState<{
    fileName: string;
    rowCount: number;
    period: { start: string; end: string };
    columns: Record<string, string>;
    data: MultiChannelData;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setPreview(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/upload?channel=${channel}`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `서버 오류 (${res.status})`);
      setPreview({
        fileName: json.fileName,
        rowCount: json.rowCount,
        period:   json.period,
        columns:  json.columns,
        data:     json.data,
      });
    } catch (e: any) {
      setError(e.message ?? "업로드 실패");
    } finally {
      setLoading(false);
    }
  }, [channel]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    uploadFile(files[0]);
  }, [uploadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const confirmUse = useCallback(() => {
    if (!preview) return;
    const meta: UploadMeta = {
      fileName:   preview.fileName,
      rowCount:   preview.rowCount,
      period:     preview.period,
      uploadedAt: new Date().toISOString(),
    };
    onDataLoaded(preview.data, meta);
    setPreview(null);
  }, [preview, onDataLoaded]);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      {/* 헤더 */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderLeft: `4px solid ${channelColor}` }}
      >
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={18} style={{ color: channelColor }} />
          <span className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm">
            {channelName} 엑셀 데이터 업로드
          </span>
        </div>
        {currentMeta && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-red-500 transition-colors"
          >
            <Trash2 size={13} />
            업로드 데이터 삭제
          </button>
        )}
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* 현재 업로드 상태 */}
        {currentMeta && !preview && (
          <div className="flex items-start gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">실 데이터 사용 중</p>
              <p className="text-xs mt-0.5 opacity-80">
                {currentMeta.fileName} · {currentMeta.rowCount.toLocaleString()}건 ·{" "}
                {currentMeta.period.start} ~ {currentMeta.period.end}
              </p>
            </div>
          </div>
        )}

        {/* 도움말 */}
        <div className="flex items-start gap-2 text-xs text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3">
          <Info size={13} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-zinc-500 dark:text-zinc-300">{channelName} 엑셀 내보내기 방법</p>
            {channel === "wconcept" && (
              <p className="mt-0.5">W컨셉 파트너 센터 → 주문관리 → 주문목록 → 엑셀 다운로드</p>
            )}
            {channel === "musinsa" && (
              <p className="mt-0.5">무신사 스튜디오 → 주문관리 → 전체주문 → 엑셀 다운로드</p>
            )}
            {channel === "29cm" && (
              <p className="mt-0.5">29CM 파트너센터 → 주문/배송 → 주문 목록 → 엑셀 다운로드</p>
            )}
            {channel === "groupbuy" && (
              <p className="mt-0.5">공동구매 캠페인 결과를 정리한 엑셀 (날짜·상품명·수량·매출)</p>
            )}
            {channel === "kakao_gift" && (
              <p className="mt-0.5">카카오선물하기 정산 시트(구글시트) → 파일 → 다운로드 → CSV 또는 엑셀</p>
            )}
            {channel === "sixshop" && (
              <p className="mt-0.5">식스샵 관리자 → 주문관리 → 주문목록 → 엑셀 다운로드</p>
            )}
            {channel === "naver_smartstore" && (
              <p className="mt-0.5">스마트스토어센터 → 판매관리 → 주문통합검색 → 엑셀 다운로드 (API 자동화 예정)</p>
            )}
            {channel === "sixshop_global" && (
              <>
                <p className="mt-0.5">식스샵 글로벌 관리자 → 주문관리 → 주문목록 → 엑셀 다운로드</p>
                <p className="mt-0.5 text-amber-600 dark:text-amber-400">
                  ⓘ USD 결제 채널 — 업로드 시 자동으로 1USD = ₩1,450 환율 적용해 KRW로 환산
                </p>
              </>
            )}
            <p className="mt-1 text-zinc-300 dark:text-zinc-500">지원 형식: .xlsx, .xls, .csv (최대 10MB)</p>
          </div>
        </div>

        {/* 드래그앤드롭 영역 */}
        {!preview && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`
              relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all
              ${dragging
                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/20"
                : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 bg-zinc-50/50 dark:bg-zinc-800/30"}
            `}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />
            {loading ? (
              <>
                <Loader2 size={28} className="text-zinc-400 animate-spin" />
                <p className="text-sm text-zinc-500">파일 파싱 중...</p>
              </>
            ) : (
              <>
                <Upload size={28} className={dragging ? "text-blue-500" : "text-zinc-400"} />
                <div className="text-center">
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                    파일을 드래그하거나 클릭해서 선택
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">.xlsx · .xls · .csv</p>
                </div>
              </>
            )}
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-300">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">파싱 실패</p>
              <p className="text-xs mt-0.5 whitespace-pre-line">{error}</p>
              <button
                onClick={() => { setError(null); inputRef.current?.click(); }}
                className="text-xs underline mt-1"
              >
                다시 시도
              </button>
            </div>
          </div>
        )}

        {/* 미리보기 */}
        {preview && (
          <div className="space-y-3">
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4 space-y-3">
              {/* 파일 정보 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FileSpreadsheet size={16} className="text-emerald-500 shrink-0" />
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">{preview.fileName}</p>
                </div>
                <button onClick={() => setPreview(null)} className="text-zinc-400 hover:text-zinc-600">
                  <X size={16} />
                </button>
              </div>

              {/* 요약 KPI */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "총 주문건", value: preview.rowCount.toLocaleString() + "건" },
                  { label: "기간", value: `${preview.period.start.slice(5)} ~ ${preview.period.end.slice(5)}` },
                  { label: "월 매출", value: fmtKRW(preview.data.salesSummary.month.revenue) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-white dark:bg-zinc-900 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-zinc-400">{label}</p>
                    <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {/* 감지된 컬럼 */}
              <div>
                <p className="text-[10px] text-zinc-400 mb-1.5">감지된 컬럼</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(preview.columns).map(([key, name]) => (
                    <span key={key} className={`text-[10px] px-2 py-0.5 rounded-full ${
                      name === "(없음)"
                        ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-400"
                        : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                    }`}>
                      {key === "date" ? "날짜" : key === "name" ? "상품명" : key === "sku" ? "SKU" : key === "qty" ? "수량" : "금액"}: {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 상품 순위 미리보기 */}
            {preview.data.topProducts.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-500 mb-2">상위 상품</p>
                <div className="space-y-1">
                  {preview.data.topProducts.slice(0, 3).map(p => (
                    <div key={p.sku || p.name} className="flex items-center justify-between text-xs py-1.5 px-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                      <span className="text-zinc-600 dark:text-zinc-300 truncate flex-1">{p.name || p.sku}</span>
                      <span className="text-zinc-500 ml-2 shrink-0">{p.sold}건 / {fmtKRW(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 버튼 */}
            <div className="flex gap-2">
              <button
                onClick={confirmUse}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: channelColor }}
              >
                <CheckCircle size={15} />
                이 데이터 사용하기
              </button>
              <button
                onClick={() => { setPreview(null); inputRef.current?.click(); }}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                다시 선택
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
