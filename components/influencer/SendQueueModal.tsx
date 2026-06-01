"use client";

import { useState, useEffect } from "react";
import { X, Copy, ExternalLink, Check, SkipForward, CheckCircle } from "lucide-react";
import {
  addMessage,
  updateInfluencer,
  STATUS_CONFIG,
  formatFollowers,
  type Influencer,
} from "@/lib/influencerStorage";
import { getRecommendedTemplate } from "@/lib/dmTemplates";

/** 프로필이 아니라 DM 작성창으로 바로 진입하는 딥링크. */
const IG_DM_DEEPLINK = (handle: string) => `https://ig.me/m/${handle.replace(/^@/, "")}`;

/** 첫 DM 이전 단계 — 보냄 표시 시 'DM발송'으로 진행. */
const PRE_DM = ["discovered", "reviewing", "approved"];

interface Props {
  /** 순차로 돌릴 인플루언서 목록(열 때 스냅샷). */
  queue: Influencer[];
  onUpdate: () => void;
  onClose: () => void;
}

export default function SendQueueModal({ queue, onUpdate, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);

  const inf = queue[idx];
  const done = idx >= queue.length;

  // 현재 대상 바뀌면 추천 템플릿 자동 세팅
  useEffect(() => {
    if (inf) setText(getRecommendedTemplate(inf.status).render(inf));
    setCopied(false);
    setImgFailed(false);
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC 닫기
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const copyAndOpen = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    window.open(IG_DM_DEEPLINK(inf.handle), "_blank");
  };

  const markSentNext = () => {
    addMessage(inf.id, { direction: "outgoing", content: text, isTemplate: true });
    if (PRE_DM.includes(inf.status)) updateInfluencer(inf.id, { status: "dm_sent" });
    setSentCount((c) => c + 1);
    onUpdate();
    setIdx((i) => i + 1);
  };

  const skipNext = () => setIdx((i) => i + 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
        {/* 헤더 + 진행 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">순차 발송</span>
            <span className="text-xs text-zinc-400">
              {done ? `${queue.length}/${queue.length}` : `${idx + 1} / ${queue.length}`}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>
        {/* 진행 바 */}
        <div className="h-1 bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full bg-violet-600 transition-all"
            style={{ width: `${(Math.min(idx, queue.length) / Math.max(1, queue.length)) * 100}%` }}
          />
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <CheckCircle size={40} className="text-emerald-500" />
            <p className="text-base font-semibold text-zinc-800 dark:text-zinc-100">발송 큐 완료</p>
            <p className="text-sm text-zinc-500">
              {queue.length}명 중 <span className="font-semibold text-violet-600">{sentCount}명</span> 보냄 표시
              {queue.length - sentCount > 0 && `, ${queue.length - sentCount}명 건너뜀`}
            </p>
            <button
              onClick={onClose}
              className="mt-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
            >
              닫기
            </button>
          </div>
        ) : (
          <>
            {/* 현재 대상 */}
            <div className="flex items-center gap-3 px-5 pt-4">
              <div className="rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 shrink-0">
                {inf.profileImage && !imgFailed ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={inf.profileImage}
                    alt={inf.handle}
                    onError={() => setImgFailed(true)}
                    className="w-11 h-11 rounded-full object-cover bg-white dark:bg-zinc-900"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-pink-400 to-violet-500 flex items-center justify-center text-white font-bold">
                    {(inf.name || inf.handle).slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">@{inf.handle}</p>
                  <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_CONFIG[inf.status].bg} ${STATUS_CONFIG[inf.status].color}`}>
                    {STATUS_CONFIG[inf.status].label}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 truncate">
                  {inf.name && inf.name !== inf.handle ? inf.name : ""}
                  {inf.followers > 0 && ` · ${formatFollowers(inf.followers)} followers`}
                </p>
              </div>
            </div>

            {/* 템플릿 (편집 가능) */}
            <div className="px-5 pt-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={7}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            {/* 액션 */}
            <div className="px-5 py-4 space-y-2">
              <button
                onClick={copyAndOpen}
                className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-semibold rounded-xl py-3 text-sm transition-colors"
              >
                {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                {copied ? "복사됨 — 인스타에 붙여넣기" : "복사 + DM 열기"}
                <ExternalLink size={12} className="opacity-50" />
              </button>
              <div className="flex gap-2">
                <button
                  onClick={markSentNext}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors"
                >
                  <CheckCircle size={15} /> 보냄 · 다음
                </button>
                <button
                  onClick={skipNext}
                  className="flex items-center justify-center gap-1.5 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm transition-colors"
                >
                  <SkipForward size={15} /> 건너뛰기
                </button>
              </div>
              <p className="text-[11px] text-zinc-400 text-center pt-0.5">
                복사 + DM 열기 → 인스타에 붙여넣고 전송 → 보냄·다음
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
