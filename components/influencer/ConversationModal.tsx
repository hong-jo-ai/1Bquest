"use client";

import { useState, useEffect, useRef } from "react";
import {
  X, Send, Copy, ExternalLink, CheckCircle, MessageSquare,
  ChevronDown, ArrowRight, Sparkles, Loader2,
} from "lucide-react";
import type { Influencer } from "@/lib/influencerStorage";
import {
  addMessage, updateInfluencer, advanceStatus,
  STATUS_CONFIG, PLATFORM_CONFIG,
} from "@/lib/influencerStorage";
import {
  DM_TEMPLATES, getRecommendedTemplate, analyzeSentiment,
} from "@/lib/dmTemplates";

interface Props {
  influencer: Influencer;
  onUpdate: () => void;
  onClose: () => void;
}

// 프로필이 아니라 DM 작성창으로 바로 진입하는 딥링크.
const INSTAGRAM_DM_URL = (handle: string) =>
  `https://ig.me/m/${handle.replace(/^@/, "")}`;

export default function ConversationModal({ influencer, onUpdate, onClose }: Props) {
  const [inf, setInf]           = useState<Influencer>(influencer);
  const [templateText, setTemplateText] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [replyInput, setReplyInput] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sentConfirmed, setSentConfirmed] = useState(false);
  const [apiState, setApiState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [apiNotice, setApiNotice] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 실제 인스타 DM 대화 (CS 인박스 cs_messages) — 로컬 messages[] 대신 진짜 대화를 보여준다.
  interface RealMsg { direction: "in" | "out"; text: string; sentAt: string }
  const [conv, setConv] = useState<{
    loaded: boolean; hasThread: boolean; canApiReply: boolean;
    lastInboundAt?: string; messages: RealMsg[];
  }>({ loaded: false, hasThread: false, canApiReply: false, messages: [] });

  const fetchConv = async () => {
    try {
      const r = await fetch(
        `/api/influencer/conversation?handle=${encodeURIComponent(inf.handle.replace(/^@/, ""))}`,
      );
      const j = await r.json();
      if (j?.ok) {
        setConv({
          loaded: true, hasThread: !!j.hasThread, canApiReply: !!j.canApiReply,
          lastInboundAt: j.lastInboundAt, messages: Array.isArray(j.messages) ? j.messages : [],
        });
      } else {
        setConv((c) => ({ ...c, loaded: true }));
      }
    } catch {
      setConv((c) => ({ ...c, loaded: true }));
    }
  };
  // 열릴 때 + 인플루언서 바뀔 때 실제 대화 로드
  useEffect(() => { fetchConv(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [inf.id]);

  // 추천 템플릿 자동 세팅
  useEffect(() => {
    const recommended = getRecommendedTemplate(inf.status);
    setTemplateText(recommended.render(inf));
    setSelectedTemplate(recommended.id);
  }, [inf.status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [inf.messages, conv.messages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const reload = () => {
    const list = JSON.parse(localStorage.getItem("paulvice_influencers_v1") || "[]");
    const updated = list.find((i: Influencer) => i.id === inf.id);
    if (updated) setInf(updated);
    onUpdate();
  };

  const handleCopyAndOpen = () => {
    navigator.clipboard.writeText(templateText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    window.open(INSTAGRAM_DM_URL(inf.handle), "_blank");
  };

  const handleMarkSent = () => {
    addMessage(inf.id, { direction: "outgoing", content: templateText, isTemplate: true });
    // DM발송 이전(발굴·검토·승인) 어느 단계에서 보내든 'DM발송'으로 진행.
    // 이미 답장수신 이후 단계면 되돌리지 않는다.
    if (["discovered", "reviewing", "approved"].includes(inf.status)) {
      updateInfluencer(inf.id, { status: "dm_sent" });
    }
    setSentConfirmed(true);
    setTimeout(() => setSentConfirmed(false), 2000);
    reload();
  };

  // 실제 24시간 답장 윈도우(상대가 최근 24h 내 DM 보냄)일 때만 API 직접 발송 가능.
  const canApiSend = conv.canApiReply;

  const handleApiSend = async () => {
    if (apiState === "sending" || !templateText.trim()) return;
    setApiState("sending");
    setApiNotice("");
    try {
      const res = await fetch("/api/influencer/send-dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: inf.handle, text: templateText }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        setApiState("done");
        setApiNotice(`${j.account ?? "@paulvice.kr"}로 전송됐어요.`);
        setTimeout(() => setApiState("idle"), 2500);
        fetchConv(); // 실제 대화에 방금 보낸 메시지 반영
      } else {
        setApiState("error");
        setApiNotice(j.error ?? `전송 실패 (HTTP ${res.status})`);
      }
    } catch (e: any) {
      setApiState("error");
      setApiNotice(e?.message ?? "네트워크 오류");
    }
  };

  // AI 맞춤 초안 생성 → 템플릿 텍스트에 채움
  const handleAiDraft = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    try {
      const kind = inf.status === "dm_sent" ? "followup" : "initial";
      const r = await fetch("/api/influencer/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: inf.handle, kind }),
      });
      const j = await r.json();
      if (j?.ok && j.draft) {
        setTemplateText(j.draft);
        setShowTemplates(true);
      }
    } catch {
      /* 무시 — 실패 시 기존 템플릿 유지 */
    }
    setAiLoading(false);
  };

  const handleSubmitReply = () => {
    if (!replyInput.trim()) return;
    const sentiment = analyzeSentiment(replyInput);
    addMessage(inf.id, { direction: "incoming", content: replyInput.trim(), isTemplate: false });

    // 상태 자동 진행
    if (inf.status === "dm_sent") {
      updateInfluencer(inf.id, { status: "replied" });
    } else if (inf.status === "replied" && sentiment === "positive") {
      updateInfluencer(inf.id, { status: "negotiating" });
    }

    // 답장에 맞는 다음 템플릿 세팅
    const nextTemplate = getRecommendedTemplate(inf.status, replyInput.trim());
    setTemplateText(nextTemplate.render(inf));
    setSelectedTemplate(nextTemplate.id);
    setReplyInput("");
    reload();
  };

  const handleAdvance = () => {
    const next = advanceStatus(inf.id);
    if (next) reload();
  };

  const statusCfg = STATUS_CONFIG[inf.status];
  const platformCfg = PLATFORM_CONFIG[inf.platform];
  const canAdvance = STATUS_CONFIG[inf.status].next !== null && inf.status !== "rejected";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-2xl h-[88vh] flex flex-col overflow-hidden">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            {inf.profileImage ? (
              <img src={inf.profileImage} alt={inf.name} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-violet-500 flex items-center justify-center text-white font-bold text-sm">
                {inf.name.charAt(0)}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-zinc-800 dark:text-zinc-100 text-sm">{inf.name}</p>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>
              </div>
              <p className={`text-xs ${platformCfg.color}`}>@{inf.handle} · {platformCfg.label}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canAdvance && (
              <button
                onClick={handleAdvance}
                className="flex items-center gap-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                <ArrowRight size={13} />
                {STATUS_CONFIG[STATUS_CONFIG[inf.status].next!].label}로 이동
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 대화 내역 — 실제 IG DM(cs_messages)이 있으면 그걸, 없으면 로컬 기록/빈 상태 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {conv.hasThread && conv.messages.length > 0 ? (
            <>
              <div className="flex justify-center">
                <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-full px-2.5 py-1">
                  실제 인스타 DM · @paulvice.kr
                </span>
              </div>
              {conv.messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                    msg.direction === "out"
                      ? "bg-violet-600 text-white rounded-br-sm"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-bl-sm"
                  }`}>
                    {msg.text}
                    <p className={`text-[10px] mt-1 ${msg.direction === "out" ? "text-violet-200" : "text-zinc-400"}`}>
                      {new Date(msg.sentAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </>
          ) : inf.messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
              <MessageSquare size={32} className="opacity-30" />
              <p className="text-sm">아직 대화 내역이 없습니다</p>
              <p className="text-xs">
                {conv.loaded && !conv.hasThread
                  ? "아직 DM을 주고받은 적이 없어요. 아래 템플릿을 복사해 먼저 보내보세요"
                  : "아래 DM 템플릿을 복사하여 발송하세요"}
              </p>
            </div>
          ) : (
            inf.messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.direction === "outgoing" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
                  msg.direction === "outgoing"
                    ? "bg-violet-600 text-white rounded-br-sm"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-bl-sm"
                }`}>
                  {msg.content}
                  <p className={`text-[10px] mt-1 ${msg.direction === "outgoing" ? "text-violet-200" : "text-zinc-400"}`}>
                    {new Date(msg.timestamp).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {msg.isTemplate && " · 템플릿"}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 답장 붙여넣기 — 실제 IG 대화가 아직 없을 때만(있으면 답장이 자동 유입됨) */}
        {!conv.hasThread && (inf.status === "dm_sent" || inf.status === "replied" || inf.status === "negotiating") && (
          <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
            <p className="text-xs text-zinc-400 mb-2 flex items-center gap-1">
              <MessageSquare size={11} />
              받은 답장 입력 (붙여넣기)
            </p>
            <div className="flex gap-2">
              <textarea
                value={replyInput}
                onChange={(e) => setReplyInput(e.target.value)}
                placeholder="인플루언서에게서 받은 답장 내용을 붙여넣으세요..."
                rows={2}
                className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <button
                onClick={handleSubmitReply}
                disabled={!replyInput.trim()}
                className="px-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-xl transition-colors"
              >
                <Send size={15} />
              </button>
            </div>
            {replyInput && (
              <p className={`text-xs mt-1 font-medium ${
                analyzeSentiment(replyInput) === "positive" ? "text-emerald-500" :
                analyzeSentiment(replyInput) === "negative" ? "text-red-500" :
                "text-zinc-400"
              }`}>
                {analyzeSentiment(replyInput) === "positive" ? "✅ 긍정적인 답변 — 다음 단계 템플릿을 자동 추천합니다" :
                 analyzeSentiment(replyInput) === "negative" ? "❌ 부정적인 답변 — 거절 응대 템플릿을 추천합니다" :
                 "💭 답변 분석 중..."}
              </p>
            )}
          </div>
        )}

        {/* DM 템플릿 영역 */}
        <div className="border-t border-zinc-100 dark:border-zinc-800 shrink-0">
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-violet-500" />
              DM 템플릿
              <span className="text-xs text-zinc-400">({DM_TEMPLATES.find((t) => t.id === selectedTemplate)?.label ?? "선택"})</span>
            </span>
            <ChevronDown size={15} className={`transition-transform ${showTemplates ? "rotate-180" : ""}`} />
          </button>

          {showTemplates && (
            <div className="px-5 pb-3 space-y-2">
              {/* 템플릿 선택 */}
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={handleAiDraft}
                  disabled={aiLoading}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-violet-400 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-all flex items-center gap-1 disabled:opacity-50"
                  title="인플루언서에 맞춘 초안을 AI가 작성합니다"
                >
                  {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  AI 초안
                </button>
                {DM_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setSelectedTemplate(t.id); setTemplateText(t.render(inf)); }}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                      selectedTemplate === t.id
                        ? "bg-violet-600 text-white border-violet-600"
                        : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300"
                    }`}
                  >
                    {t.emoji} {t.label}
                  </button>
                ))}
              </div>
              {/* 템플릿 텍스트 */}
              <textarea
                value={templateText}
                onChange={(e) => setTemplateText(e.target.value)}
                rows={5}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          )}

          {/* 답장 단계: @paulvice.kr로 API 직접 발송 (복붙 없이) */}
          {canApiSend && (
            <div className="px-5 pb-2">
              <button
                onClick={handleApiSend}
                disabled={apiState === "sending" || !templateText.trim()}
                className={`w-full flex items-center justify-center gap-1.5 font-semibold rounded-xl py-3 text-sm transition-colors disabled:opacity-50 ${
                  apiState === "done" ? "bg-emerald-500 text-white" : "bg-violet-600 hover:bg-violet-700 text-white"
                }`}
              >
                {apiState === "sending" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : apiState === "done" ? (
                  <CheckCircle size={15} />
                ) : (
                  <Send size={15} />
                )}
                {apiState === "sending"
                  ? "전송 중…"
                  : apiState === "done"
                  ? "전송됐어요!"
                  : "@paulvice.kr로 바로 전송"}
              </button>
              {apiNotice && (
                <p className={`mt-1.5 text-xs leading-relaxed ${apiState === "error" ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {apiState === "error" ? "⚠️ " : ""}
                  {apiNotice}
                </p>
              )}
              <p className="mt-1 text-[11px] text-zinc-400">또는 아래로 수동 발송</p>
            </div>
          )}

          {/* 실제 대화는 있는데 24h 창이 지난 경우 */}
          {conv.hasThread && !conv.canApiReply && (
            <div className="px-5 pb-2">
              <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
                ⏱️ 마지막 답장 후 24시간이 지나 앱에서 바로 전송이 안 돼요(인스타 정책). 아래 &quot;복사 + DM 열기&quot;로 보내주세요.
              </p>
            </div>
          )}

          {/* 발송 액션 버튼 */}
          <div className="flex gap-2 px-5 pb-4">
            <button
              onClick={handleCopyAndOpen}
              className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-800 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-semibold rounded-xl py-3 text-sm transition-colors"
            >
              {copied ? <CheckCircle size={15} className="text-emerald-400" /> : <Copy size={15} />}
              {copied ? "복사됨!" : "복사 + DM 열기"}
              <ExternalLink size={12} className="opacity-50" />
            </button>
            <button
              onClick={handleMarkSent}
              className={`flex items-center gap-1.5 px-4 font-semibold rounded-xl py-3 text-sm transition-colors ${
                sentConfirmed
                  ? "bg-emerald-500 text-white"
                  : "bg-violet-600 hover:bg-violet-700 text-white"
              }`}
            >
              {sentConfirmed ? <CheckCircle size={15} /> : <Send size={15} />}
              {sentConfirmed ? "발송 완료!" : "발송 완료"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
