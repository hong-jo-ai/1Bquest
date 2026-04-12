"use client";

import { useState, useEffect, useCallback } from "react";

import {
  TrendingUp, BookmarkPlus, PenLine, RefreshCw, Copy, Trash2,
  Heart, ChevronDown, ChevronUp, Loader2, Link2, Sparkles,
  X, Check, BarChart2, Lightbulb, MessageCircle, Zap, Send,
  ImagePlus, Film, Clock, CalendarClock, Pencil, Settings, Minus, Plus,
  CornerDownRight, CheckCircle2,
} from "lucide-react";
import {
  loadRefs, addRef, deleteRef,
  loadPosts, addPosts, toggleLike, deletePost, updatePostText, updatePostMedia, removePostMedia,
  loadTrend, saveTrend, migrateOldKeys,
  type ThreadsRef, type GeneratedPost, type TrendAnalysis,
  type ThreadsCategory, type PostStyle,
} from "@/lib/threadsStorage";
import { BRANDS, BRAND_LIST, type BrandId } from "@/lib/threadsBrands";

type Tab = "generate" | "published";

const CATEGORIES: ThreadsCategory[] = ["패션", "시계", "주얼리", "패션잡화", "브랜드", "라이프스타일", "기타"];
const STYLES: PostStyle[] = ["공감형", "정보형", "질문형", "스토리형", "선언형", "감성형"];
const STYLE_DESC: Record<PostStyle, string> = {
  공감형: '"이 느낌 알아요?" 공감을 끌어내는',
  정보형: '"이거 몰랐죠?" 유용한 정보 제공',
  질문형: '답글을 유도하는 질문',
  스토리형: '짧지만 몰입되는 이야기',
  선언형: '강한 의견·주장으로 대화 유발',
  감성형: '분위기와 무드를 파는',
};

// ── 공통 유틸 ─────────────────────────────────────────────────────────────

function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };
  return { copiedId, copy };
}

// ── Threads 로고 ──────────────────────────────────────────────────────────

function ThreadsLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 192 192" fill="currentColor">
      <path d="M141.537 88.988a66.667 66.667 0 0 0-2.518-1.143c-1.482-27.307-16.403-42.94-41.457-43.1h-.34c-14.986 0-27.449 6.396-35.12 18.036l13.779 9.452c5.73-8.695 14.724-10.548 21.348-10.548h.229c8.249.053 14.474 2.452 18.503 7.129 2.932 3.405 4.893 8.111 5.864 14.05-7.314-1.243-15.224-1.626-23.68-1.14-23.82 1.371-39.134 15.264-38.105 34.568.522 9.792 5.4 18.216 13.735 23.719 7.047 4.652 16.124 6.927 25.557 6.412 12.458-.683 22.231-5.436 29.049-14.127 5.178-6.6 8.452-15.153 9.898-25.93 5.937 3.583 10.337 8.298 12.767 13.966 4.132 9.635 4.373 25.468-8.546 38.318-11.319 11.258-24.925 16.124-45.488 16.274-22.809-.169-40.06-7.484-51.275-21.741C35.236 139.966 29.808 120.682 29.605 96c.203-24.682 5.63-43.966 16.133-57.317C57.653 25.425 74.905 18.11 97.714 17.942c22.976.17 40.526 7.52 52.171 21.847 5.71 7.026 10.015 15.86 12.853 26.162l16.147-4.308c-3.44-12.68-8.853-23.606-16.219-32.668C147.036 12.56 125.202 3.295 97.768 3.1h-.056C70.354 3.295 48.81 12.586 34.072 28.82 20.83 43.428 13.997 64.36 13.79 96.114l-.002.029.002.028c.207 31.755 7.04 52.68 20.28 67.288 14.738 16.234 36.282 25.524 63.636 25.72h.054c24.154-.163 41.426-6.479 55.355-20.339 18.285-18.204 17.747-41.055 11.716-55.042-4.262-9.933-12.45-17.952-23.294-23.81z"/>
      <path d="M98.44 129.507c-10.006.563-20.378-3.879-20.926-13.594-.37-6.79 4.827-14.369 21.8-15.337 1.903-.11 3.776-.163 5.617-.163 5.928 0 11.489.57 16.59 1.671-1.889 23.529-13.078 26.849-23.081 27.423z"/>
    </svg>
  );
}

// ── 탭 버튼 ───────────────────────────────────────────────────────────────

function TabBtn({ tab, active, label, icon: Icon, badge, onClick }: {
  tab: Tab; active: boolean; label: string; icon: React.ElementType;
  badge?: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap flex-shrink-0 ${
        active
          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm"
          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      <Icon size={14} />
      {label}
      {!!badge && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? "bg-white/20 dark:bg-zinc-900/30" : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500"}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ── 트렌드 분석 탭 ────────────────────────────────────────────────────────

function TrendTab({ brand }: { brand: BrandId }) {
  const brandConfig = BRANDS[brand];
  const [trend, setTrend]       = useState<TrendAnalysis | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>(brandConfig.defaultKeywords);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { setTrend(loadTrend(brand)); }, [brand]);
  useEffect(() => { setKeywords(brandConfig.defaultKeywords); }, [brand, brandConfig.defaultKeywords]);

  const analyze = async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/threads/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, brand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      saveTrend(data, brand);
      setTrend(data);
    } catch (e: any) {
      setError(e.message ?? "분석 실패");
    } finally {
      setLoading(false);
    }
  };

  const toggleKw = (kw: ThreadsCategory) =>
    setKeywords((prev) => prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw]);

  return (
    <div className="space-y-5">
      {/* 키워드 선택 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">분석할 카테고리 선택</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => toggleKw(c)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                keywords.includes(c)
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                  : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400"
              }`}>
              {c}
            </button>
          ))}
        </div>
        <button
          onClick={analyze} disabled={loading || keywords.length === 0}
          className="flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? "분석 중..." : "바이럴 트렌드 분석"}
        </button>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        {trend && <p className="text-[11px] text-zinc-400 mt-2">마지막 분석: {new Date(trend.generatedAt).toLocaleString("ko-KR")}</p>}
      </div>

      {trend && (
        <>
          {/* 바이럴 포맷 */}
          <Section title="바이럴 포맷 유형" icon={BarChart2}>
            <div className="grid gap-3">
              {trend.formats.map((f, i) => (
                <div key={i} className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                  <button className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    onClick={() => setExpanded(expanded === `f${i}` ? null : `f${i}`)}>
                    <div>
                      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{f.name}</span>
                      <p className="text-xs text-zinc-500 mt-0.5">{f.description}</p>
                    </div>
                    {expanded === `f${i}` ? <ChevronUp size={14} className="text-zinc-400 shrink-0" /> : <ChevronDown size={14} className="text-zinc-400 shrink-0" />}
                  </button>
                  {expanded === `f${i}` && (
                    <div className="px-4 pb-4 pt-0">
                      <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed border-l-4 border-zinc-300 dark:border-zinc-600 italic">
                        {f.example}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* 효과적인 Hook */}
          <Section title="스크롤 멈추는 Hook" icon={Zap}>
            <div className="grid gap-2">
              {trend.hooks.map((h, i) => (
                <div key={i} className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
                  <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-1">{h.hook}</p>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 italic">"{h.example}"</p>
                </div>
              ))}
            </div>
          </Section>

          {/* 테마 */}
          <Section title="폴바이스에 맞는 인기 테마" icon={TrendingUp}>
            <div className="grid gap-3">
              {trend.themes.map((t, i) => (
                <div key={i} className="rounded-xl border border-zinc-100 dark:border-zinc-800 p-4">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">{t.theme}</p>
                  <p className="text-xs text-zinc-500 mb-2">{t.reason}</p>
                  <div className="flex items-start gap-1.5 bg-violet-50 dark:bg-violet-900/20 rounded-lg px-3 py-2">
                    <Lightbulb size={12} className="shrink-0 mt-0.5 text-violet-500" />
                    <p className="text-xs text-violet-700 dark:text-violet-300">{t.paulviceAngle}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* 인사이트 */}
          <Section title="바로 쓸 수 있는 인사이트" icon={Lightbulb}>
            <ul className="space-y-2">
              {trend.insights.map((ins, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  {ins}
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {!trend && !loading && (
        <div className="text-center py-16 text-zinc-400">
          <BarChart2 size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">위에서 카테고리를 선택하고 분석을 시작하세요</p>
        </div>
      )}
    </div>
  );
}

// ── 레퍼런스 수집 탭 ──────────────────────────────────────────────────────

function RefsTab({ onRefsChange, brand }: { onRefsChange: (n: number) => void; brand: BrandId }) {
  const [refs, setRefs]         = useState<ThreadsRef[]>([]);
  const [input, setInput]       = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { copiedId, copy }      = useCopy();

  const reload = useCallback(() => {
    const r = loadRefs(brand); setRefs(r); onRefsChange(r.length);
  }, [onRefsChange]);

  useEffect(() => { reload(); }, [reload]);

  const analyzeAndSave = async () => {
    const text = input.trim();
    const url  = urlInput.trim();
    if (!text && !url) return;

    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/threads/analyze-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, url, brand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      addRef({
        text: data.text || text,
        url: url || undefined,
        category: data.category,
        analysis: {
          hook:    data.hook,
          format:  data.format,
          tone:    data.tone,
          drivers: data.drivers,
          lesson:  data.lesson,
        },
      }, brand);
      setInput(""); setUrlInput("");
      reload();
    } catch (e: any) {
      setError(e.message ?? "분석 실패");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    deleteRef(id, brand); reload();
  };

  const CATEGORY_COLORS: Record<string, string> = {
    패션: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
    시계: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    주얼리: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    패션잡화: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
    브랜드: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    라이프스타일: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    기타: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };

  return (
    <div className="space-y-5">
      {/* 입력 폼 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5 space-y-3">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">레퍼런스 글 추가</p>

        {/* URL 입력 */}
        <div className="relative">
          <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Threads 글 URL (선택) — URL만 있어도 자동 분석 시도"
            className="w-full pl-9 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
        </div>

        {/* 텍스트 입력 */}
        <textarea
          rows={4} value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={"반응 좋은 쓰레드 글을 여기에 붙여넣으세요.\nURL만 입력해도 글 내용 자동 추출을 시도합니다."}
          className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 resize-none"
        />

        <div className="flex items-center gap-3">
          <button
            onClick={analyzeAndSave} disabled={loading || (!input.trim() && !urlInput.trim())}
            className="flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {loading ? "AI 분석 중..." : "분석하고 저장"}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>

      {/* 저장된 레퍼런스 */}
      {refs.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">
          <BookmarkPlus size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">반응 좋은 쓰레드 글을 붙여넣어 저장하세요</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-medium text-zinc-400">{refs.length}개 저장됨</p>
          {refs.map((ref) => (
            <div key={ref.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CATEGORY_COLORS[ref.category] ?? CATEGORY_COLORS["기타"]}`}>
                    {ref.category}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => copy(ref.text, ref.id)} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 transition-colors">
                      {copiedId === ref.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                    <button onClick={() => handleDelete(ref.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-400 hover:text-red-500 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed line-clamp-3">
                  {ref.text}
                </p>
                {ref.url && (
                  <a href={ref.url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-500 hover:underline mt-1 inline-block truncate max-w-full">
                    {ref.url}
                  </a>
                )}

                <button onClick={() => setExpanded(expanded === ref.id ? null : ref.id)}
                  className="mt-3 flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors">
                  {expanded === ref.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  AI 분석 결과 {expanded === ref.id ? "접기" : "보기"}
                </button>
              </div>

              {expanded === ref.id && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 pb-4 pt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-zinc-400 mb-1">형식</p>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300">{ref.analysis.format}</p>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
                      <p className="text-[10px] font-semibold text-zinc-400 mb-1">톤</p>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300">{ref.analysis.tone}</p>
                    </div>
                  </div>
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-zinc-400 mb-1">Hook 방식</p>
                    <p className="text-xs text-zinc-700 dark:text-zinc-300">{ref.analysis.hook}</p>
                  </div>
                  <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
                    <p className="text-[10px] font-semibold text-zinc-400 mb-2">반응 유발 요소</p>
                    <ul className="space-y-1">
                      {ref.analysis.drivers.map((d, i) => (
                        <li key={i} className="text-xs text-zinc-700 dark:text-zinc-300 flex items-start gap-1.5">
                          <span className="text-emerald-500 mt-0.5">·</span>{d}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-3 flex items-start gap-2">
                    <Lightbulb size={13} className="shrink-0 mt-0.5 text-violet-500" />
                    <p className="text-xs text-violet-700 dark:text-violet-300">{ref.analysis.lesson}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 글 생성 탭 ────────────────────────────────────────────────────────────

function GenerateTab({ onPostsChange, brand }: { onPostsChange: (n: number) => void; brand: BrandId }) {
  const brandConfig = BRANDS[brand];
  const [posts, setPosts]       = useState<GeneratedPost[]>([]);
  const [topic, setTopic]       = useState("");
  const [style, setStyle]       = useState<PostStyle>("공감형");
  const [customCtx, setCustomCtx] = useState("");
  const [length, setLength]     = useState<"short" | "medium" | "long">("medium");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [view, setView]         = useState<"saved" | "new">("new");
  const [newPosts, setNewPosts] = useState<Omit<GeneratedPost, "id" | "savedAt" | "liked">[]>([]);
  const { copiedId, copy }      = useCopy();

  const reload = useCallback(() => {
    const p = loadPosts(brand); setPosts(p); onPostsChange(p.length);
  }, [onPostsChange, brand]);

  useEffect(() => { reload(); }, [reload]);

  const generate = async () => {
    if (!topic.trim()) return;
    setLoading(true); setError(null); setView("new");

    try {
      const res  = await fetch("/api/threads/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, style, count: 5, customContext: customCtx, brand, length }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewPosts(data.posts ?? []);
    } catch (e: any) {
      setError(e.message ?? "생성 실패");
    } finally {
      setLoading(false);
    }
  };

  const savePost = (p: typeof newPosts[number], editedText?: string) => {
    addPosts([editedText ? { ...p, text: editedText } : p], brand);
    reload();
  };

  const handleLike = (id: string) => {
    toggleLike(id, brand); reload();
  };

  const handleDelete = (id: string) => {
    deletePost(id, brand); reload();
  };

  return (
    <div className="space-y-5">
      {/* 설정 패널 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5 space-y-4">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">글 생성 설정</p>

        {/* 주제 */}
        <div>
          <label className="text-xs text-zinc-500 mb-2 block">주제</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {brandConfig.topicPresets.map((t) => (
              <button key={t} onClick={() => setTopic(t)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all ${
                  topic === t
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400"
                }`}>
                {t}
              </button>
            ))}
          </div>
          <input
            value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="주제를 직접 입력하거나 위에서 선택..."
            className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
        </div>

        {/* 스타일 */}
        <div>
          <label className="text-xs text-zinc-500 mb-2 block">스타일</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {STYLES.map((s) => (
              <button key={s} onClick={() => setStyle(s)}
                className={`text-left px-3 py-2.5 rounded-xl border text-xs transition-all ${
                  style === s
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400"
                }`}>
                <p className="font-semibold">{s}</p>
                <p className="opacity-70 mt-0.5 leading-tight">{STYLE_DESC[s]}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 추가 맥락 */}
        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">추가 맥락 (선택)</label>
          <input
            value={customCtx} onChange={(e) => setCustomCtx(e.target.value)}
            placeholder="예: 봄 신제품 출시 / 화이트데이 각인 선물 / 오드리 워치 신색상..."
            className="w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
        </div>

        {/* 글 길이 */}
        <div>
          <label className="text-xs text-zinc-500 mb-2 block">글 길이</label>
          <div className="flex gap-2">
            {([
              { id: "short" as const, label: "짧게", desc: "1-2문장, 임팩트 있게" },
              { id: "medium" as const, label: "보통", desc: "3-5문장, 핵심 전달" },
              { id: "long" as const, label: "길게", desc: "6문장+, 스토리/정보 전달" },
            ]).map((l) => (
              <button key={l.id} onClick={() => setLength(l.id)}
                className={`flex-1 text-left px-3 py-2.5 rounded-xl border text-xs transition-all ${
                  length === l.id
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400"
                }`}>
                <p className="font-semibold">{l.label}</p>
                <p className="opacity-70 mt-0.5 leading-tight">{l.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={generate} disabled={loading || !topic.trim()}
            className="flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 text-sm font-semibold px-6 py-2.5 rounded-xl transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />}
            {loading ? "생성 중..." : "글 5개 생성"}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>

      {/* 탭: 새로 생성 / 저장된 글 */}
      <div className="flex gap-2">
        <button onClick={() => setView("new")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${view === "new" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
          새로 생성된 글 {newPosts.length > 0 && `(${newPosts.length})`}
        </button>
        <button onClick={() => setView("saved")}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${view === "saved" ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
          저장된 글 {posts.length > 0 && `(${posts.length})`}
        </button>
      </div>

      {/* 새로 생성된 글 */}
      {view === "new" && (
        loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Claude가 폴바이스 쓰레드 글 작성 중...</span>
          </div>
        ) : newPosts.length > 0 ? (
          <div className="space-y-4">
            {newPosts.map((p, i) => (
              <NewPostCard key={i} post={p} index={i}
                onSave={(editedText?: string) => savePost(p, editedText)}
                onCopy={() => copy(p.text, `new_${i}`)}
                copied={copiedId === `new_${i}`}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-zinc-400">
            <PenLine size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">주제와 스타일을 선택하고 생성하세요</p>
          </div>
        )
      )}

      {/* 저장된 글 */}
      {view === "saved" && (
        posts.length === 0 ? (
          <div className="text-center py-12 text-zinc-400">
            <Heart size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">마음에 드는 글을 저장하세요</p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((p) => (
              <SavedPostCard key={p.id} post={p} brand={brand}
                onLike={() => handleLike(p.id)}
                onDelete={() => handleDelete(p.id)}
                onCopy={() => copy(p.text, p.id)}
                copied={copiedId === p.id}
                onPublished={() => { deletePost(p.id, brand); reload(); }}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── 새 글 카드 ────────────────────────────────────────────────────────────

function NewPostCard({ post, index, onSave, onCopy, copied }: {
  post: Omit<GeneratedPost, "id" | "savedAt" | "liked">;
  index: number; onSave: (editedText?: string) => void; onCopy: () => void; copied: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.text);

  const handleSave = () => { onSave(editText !== post.text ? editText : undefined); setSaved(true); setEditing(false); };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-[11px] font-bold flex items-center justify-center">{index + 1}</span>
            <span className="text-[11px] font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">{post.style}</span>
          </div>
          <div className="flex items-center gap-1">
            {!saved && (
              <button onClick={() => setEditing(!editing)} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <Pencil size={14} />
              </button>
            )}
            <button onClick={() => setShowDetail(!showDetail)} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              <Lightbulb size={14} />
            </button>
            <button onClick={() => { onCopy(); }} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            </button>
            <button onClick={handleSave} disabled={saved}
              className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                saved ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                      : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300"
              }`}>
              {saved ? <><Check size={12} /> 저장됨</> : <><BookmarkPlus size={12} /> 저장</>}
            </button>
          </div>
        </div>

        {/* 글 본문 */}
        {editing ? (
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={5}
            className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4 text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed border border-violet-300 dark:border-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
          />
        ) : (
          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4 text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed border border-zinc-100 dark:border-zinc-700/50">
            {editText}
          </div>
        )}

        {/* 분석 토글 */}
        {showDetail && (
          <div className="mt-3 space-y-2">
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 flex items-start gap-2">
              <Zap size={12} className="shrink-0 mt-0.5 text-amber-500" />
              <div>
                <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 mb-0.5">Hook 포인트</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">{post.hook}</p>
              </div>
            </div>
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-3 flex items-start gap-2">
              <Lightbulb size={12} className="shrink-0 mt-0.5 text-violet-500" />
              <div>
                <p className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 mb-0.5">반응이 좋을 이유</p>
                <p className="text-xs text-violet-700 dark:text-violet-300">{post.whyItWorks}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 저장된 글 카드 ────────────────────────────────────────────────────────

function SavedPostCard({ post, onLike, onDelete, onCopy, copied, brand, onPublished }: {
  post: GeneratedPost; onLike: () => void; onDelete: () => void;
  onCopy: () => void; copied: boolean; brand: BrandId; onPublished: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [queued, setQueued] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.text);

  useEffect(() => {
    fetch("/api/threads/queue")
      .then(r => r.json())
      .then(d => {
        if ((d.queue ?? []).some((q: any) => q.id === post.id)) setQueued(true);
      })
      .catch(() => {});
  }, [post.id]);

  const handleQueue = async () => {
    setQueueError(null);
    try {
      const res = await fetch("/api/threads/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, text: post.text, brand, mediaUrl: post.mediaUrl, mediaType: post.mediaType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "큐 추가 실패");
      setQueued(true);
    } catch (e: any) {
      setQueueError(e.message);
    }
  };

  const handleMediaSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setPublishError(`파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB). 4MB 이하만 가능합니다.`);
      return;
    }
    setUploading(true);
    setPublishError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/threads/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "업로드 실패");
      updatePostMedia(post.id, json.url, json.mediaType, brand);
      // 큐에도 반영
      if (queued) {
        fetch("/api/threads/queue", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: post.id, mediaUrl: json.url, mediaType: json.mediaType }),
        }).catch(() => {});
      }
      onLike(); // trigger reload
    } catch (e: any) {
      setPublishError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = () => {
    removePostMedia(post.id, brand);
    // 큐에서도 미디어 제거
    if (queued) {
      fetch("/api/threads/queue", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, mediaUrl: undefined, mediaType: undefined }),
      }).catch(() => {});
    }
    onLike(); // trigger reload
  };

  const handleSaveEdit = () => {
    updatePostText(post.id, editText, brand);
    setEditing(false);
    onLike(); // trigger reload
  };

  const handlePublish = async () => {
    const brandName = BRANDS[brand].name;
    if (!confirm(`이 글을 ${brandName} Threads 계정에 게시할까요?`)) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/threads/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: post.text, mediaUrl: post.mediaUrl, mediaType: post.mediaType, brand }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "게시 실패");
      setPublished(true);
      onPublished();
    } catch (e: any) {
      setPublishError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className={`bg-white dark:bg-zinc-900 rounded-2xl border overflow-hidden ${
      post.liked ? "border-rose-200 dark:border-rose-800" : "border-zinc-100 dark:border-zinc-800"
    }`}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">{post.style}</span>
            <span className="text-[11px] text-zinc-400 truncate max-w-[160px]">{post.topic}</span>
          </div>
          <div className="flex items-center gap-1">
            {!published && (
              <button onClick={() => { setEditing(!editing); setEditText(post.text); }} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <Pencil size={13} />
              </button>
            )}
            <button onClick={() => setShowDetail(!showDetail)} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Lightbulb size={13} />
            </button>
            <button onClick={onCopy} className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            </button>
            <button onClick={onLike} className={`p-1.5 rounded-lg transition-colors ${post.liked ? "text-rose-500" : "text-zinc-400 hover:text-rose-500"}`}>
              <Heart size={13} fill={post.liked ? "currentColor" : "none"} />
            </button>
            <button onClick={onDelete} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={5}
              className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4 text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed border border-violet-300 dark:border-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(false)} className="text-xs text-zinc-400 hover:text-zinc-600 px-3 py-1.5">취소</button>
              <button onClick={handleSaveEdit} className="flex items-center gap-1 text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg">
                <Check size={12} /> 수정 저장
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{post.text}</p>
        )}

        {showDetail && (
          <div className="mt-3 space-y-2">
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2.5 text-xs text-amber-700 dark:text-amber-300">
              <span className="font-semibold">Hook: </span>{post.hook}
            </div>
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-2.5 text-xs text-violet-700 dark:text-violet-300">
              <span className="font-semibold">반응 이유: </span>{post.whyItWorks}
            </div>
          </div>
        )}

        {/* 미디어 첨부 + 게시 */}
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
          {/* 미디어 프리뷰 */}
          {post.mediaUrl && (
            <div className="relative inline-block">
              {post.mediaType === "VIDEO" ? (
                <video src={post.mediaUrl} className="h-24 rounded-lg object-cover" />
              ) : (
                <img src={post.mediaUrl} alt="첨부" className="h-24 rounded-lg object-cover" />
              )}
              {!published && (
                <button onClick={removeMedia}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center">
                  <X size={10} />
                </button>
              )}
              <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-black/60 text-white px-1.5 py-0.5 rounded">
                {post.mediaType === "VIDEO" ? "영상" : "이미지"}
              </span>
            </div>
          )}
          {uploading && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 size={12} className="animate-spin" /> 업로드 중...
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-[10px] text-zinc-300 dark:text-zinc-600">{new Date(post.savedAt).toLocaleDateString("ko-KR")}</p>
              {!published && !post.mediaUrl && !uploading && (
                <label className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors">
                  <ImagePlus size={13} />
                  <span>미디어 첨부</span>
                  <input type="file" accept="image/*,video/*" onChange={handleMediaSelect} className="hidden" />
                </label>
              )}
            </div>
            {published ? (
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                <Check size={12} /> 게시 완료
              </span>
            ) : (
              <div className="flex items-center gap-2">
                {!queued ? (
                  <button
                    onClick={handleQueue}
                    className="flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-700 border border-violet-200 dark:border-violet-800 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <CalendarClock size={11} /> 자동 게시
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-violet-500">
                    <Clock size={11} /> 큐 등록됨
                  </span>
                )}
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {publishing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {publishing ? "게시 중..." : post.mediaUrl ? "미디어와 함께 게시" : "즉시 게시"}
                </button>
              </div>
            )}
          </div>
        </div>
        {(publishError || queueError) && (
          <p className="text-xs text-red-500 mt-1.5">{publishError || queueError}</p>
        )}
      </div>
    </div>
  );
}

// ── 게시 관리 탭 ─────────────────────────────────────────────────────────

interface PublishedPostMetrics {
  threadId: string;
  text: string;
  publishedAt: string;
  likes: number;
  replies: number;
  views: number;
  permalink: string | null;
}

function InlinePostCard({ post, index, brand, onSave, onCopy, copiedId }: {
  post: any; index: number; brand: BrandId;
  onSave: (p: any) => void; onCopy: (text: string, id: string) => void; copiedId: string | null;
}) {
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.text);
  const id = `inline_${index}`;

  const handleSave = () => {
    onSave({ ...post, text: editText });
    setSaved(true);
    setEditing(false);
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-500 text-[10px] font-bold flex items-center justify-center">{index + 1}</span>
        <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full">{post.style}</span>
      </div>
      {editing ? (
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="w-full text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 mb-2 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none text-zinc-700 dark:text-zinc-300 min-h-[80px]"
          rows={4}
        />
      ) : (
        <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line mb-2">{editText}</p>
      )}
      {post.whyItWorks && !editing && <p className="text-[11px] text-zinc-400 mb-2">{post.whyItWorks}</p>}
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors"
            >
              <Check size={11} /> 수정 완료 & 저장
            </button>
            <button
              onClick={() => { setEditing(false); setEditText(post.text); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 transition-colors"
            >
              취소
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setEditing(true)}
              disabled={saved}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 transition-colors disabled:opacity-40"
            >
              <Pencil size={11} /> 수정
            </button>
            <button
              onClick={handleSave}
              disabled={saved}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                saved ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600" : "bg-violet-600 text-white hover:bg-violet-700"
              }`}
            >
              {saved ? <><CheckCircle2 size={11} /> 저장됨</> : <><Heart size={11} /> 저장</>}
            </button>
            <button
              onClick={() => onCopy(editText, id)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 transition-colors"
            >
              {copiedId === id ? <><Check size={11} /> 복사됨</> : <><Copy size={11} /> 복사</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface CommentData {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  hasReplied: boolean;
}

interface GeneratedReply {
  commentIndex: number;
  username: string;
  originalComment: string;
  reply: string;
}

function PublishedTab({ brand }: { brand: BrandId }) {
  const [posts, setPosts] = useState<PublishedPostMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[] | null>(null);

  // 댓글 관리 상태
  const [expandedPostId, setExpandedPostId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentData[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [generatedReplies, setGeneratedReplies] = useState<GeneratedReply[]>([]);
  const [editedReplies, setEditedReplies] = useState<Record<number, string>>({});
  const [generatingReplies, setGeneratingReplies] = useState(false);
  const [postingReplyId, setPostingReplyId] = useState<string | null>(null);
  const [postedCommentIds, setPostedCommentIds] = useState<Set<string>>(new Set());
  const [replyError, setReplyError] = useState<string | null>(null);
  const [manualDrafts, setManualDrafts] = useState<Record<string, string>>({});
  const [polishingId, setPolishingId] = useState<string | null>(null);

  // 댓글 인사이트 상태
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insights, setInsights] = useState<any | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // 직접 작성 상태
  const [showCompose, setShowCompose] = useState(false);
  const [composeText, setComposeText] = useState("");
  const [composeQueuing, setComposeQueuing] = useState(false);
  const [composePublishing, setComposePublishing] = useState(false);
  const [composeMsg, setComposeMsg] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  // 인라인 글 생성 상태
  const [inlineGenTopic, setInlineGenTopic] = useState<string | null>(null);
  const [inlineGenStyle, setInlineGenStyle] = useState<PostStyle>("공감형");
  const [inlineGenLength, setInlineGenLength] = useState<"short" | "medium" | "long">("medium");
  const [inlineGenLoading, setInlineGenLoading] = useState(false);
  const [inlineGenPosts, setInlineGenPosts] = useState<any[]>([]);
  const [inlineGenError, setInlineGenError] = useState<string | null>(null);
  const { copiedId, copy } = useCopy();

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/threads/published?brand=${brand}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "조회 실패");
      setPosts(data.posts ?? []);
      setDebugInfo(data._debug ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // 댓글 조회
  const fetchComments = async (threadId: string) => {
    if (expandedPostId === threadId) {
      setExpandedPostId(null);
      return;
    }
    setExpandedPostId(threadId);
    setComments([]);
    setGeneratedReplies([]);
    setEditedReplies({});
    setCommentsLoading(true);
    setReplyError(null);
    try {
      const res = await fetch(`/api/threads/comments?threadId=${threadId}&brand=${brand}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "댓글 조회 실패");
      setComments(data.comments ?? []);
    } catch (e: any) {
      console.error("댓글 조회 실패:", e);
      setReplyError(`댓글 조회 실패: ${e.message}`);
    } finally {
      setCommentsLoading(false);
    }
  };

  // AI 대댓글 생성
  const generateReplies = async (postText: string) => {
    // hasReplied가 아닌 댓글 대상, 없으면 전체 댓글로 시도
    let targetComments = comments.filter(c => !c.hasReplied && !postedCommentIds.has(c.id));
    if (targetComments.length === 0) targetComments = comments.filter(c => !postedCommentIds.has(c.id));
    if (targetComments.length === 0) {
      setReplyError("대댓글을 작성할 댓글이 없습니다");
      return;
    }

    setGeneratingReplies(true);
    setReplyError(null);
    try {
      const res = await fetch("/api/threads/comments/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comments: targetComments.map(c => ({ username: c.username, text: c.text })),
          postText,
          brand,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 실패");
      setGeneratedReplies(data.replies ?? []);
      const edits: Record<number, string> = {};
      for (const r of data.replies ?? []) {
        edits[r.commentIndex] = r.reply;
      }
      setEditedReplies(edits);
    } catch (e: any) {
      console.error("대댓글 생성 실패:", e);
      setReplyError(`대댓글 생성 실패: ${e.message}`);
    } finally {
      setGeneratingReplies(false);
    }
  };

  // 대댓글 게시
  const postReply = async (commentId: string, commentIndex: number) => {
    const text = editedReplies[commentIndex];
    if (!text?.trim()) return;

    setPostingReplyId(commentId);
    try {
      const res = await fetch("/api/threads/comments/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, text: text.trim(), brand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "게시 실패");
      setPostedCommentIds(prev => new Set([...prev, commentId]));
    } catch (e: any) {
      console.error("대댓글 게시 실패:", e);
      alert(`게시 실패: ${e.message}`);
    } finally {
      setPostingReplyId(null);
    }
  };

  // AI 다듬기
  const polishDraft = async (commentId: string, draft: string, originalComment: string, postText: string) => {
    if (!draft?.trim()) return;
    setPolishingId(commentId);
    setReplyError(null);
    try {
      const res = await fetch("/api/threads/comments/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, originalComment, postText, brand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "다듬기 실패");
      setManualDrafts(prev => ({ ...prev, [commentId]: data.polished }));
    } catch (e: any) {
      setReplyError(`다듬기 실패: ${e.message}`);
    } finally {
      setPolishingId(null);
    }
  };

  // 수동 대댓글 게시
  const postManualReply = async (commentId: string) => {
    const text = manualDrafts[commentId];
    if (!text?.trim()) return;
    setPostingReplyId(commentId);
    try {
      const res = await fetch("/api/threads/comments/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId, text: text.trim(), brand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "게시 실패");
      setPostedCommentIds(prev => new Set([...prev, commentId]));
    } catch (e: any) {
      console.error("대댓글 게시 실패:", e);
      alert(`게시 실패: ${e.message}`);
    } finally {
      setPostingReplyId(null);
    }
  };

  // 전체 게시
  const postAllReplies = async () => {
    const unrepliedComments = comments.filter(c => !c.hasReplied && !postedCommentIds.has(c.id));
    for (const comment of unrepliedComments) {
      const reply = generatedReplies.find(r => r.username === comment.username);
      if (!reply) continue;
      const text = editedReplies[reply.commentIndex];
      if (!text?.trim()) continue;
      await postReply(comment.id, reply.commentIndex);
    }
  };

  // 댓글 인사이트 분석
  const analyzeCommentInsights = async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    setInsights(null);
    try {
      // 최근 1달 이내 + 댓글 있는 게시물만
      const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const postsWithReplies = posts.filter(p => p.replies > 0 && new Date(p.publishedAt) >= oneMonthAgo);
      if (postsWithReplies.length === 0) {
        setInsightsError("댓글이 있는 게시물이 없습니다");
        setInsightsLoading(false);
        return;
      }

      const postsData: Array<{ text: string; comments: Array<{ username: string; text: string }> }> = [];

      for (const post of postsWithReplies.slice(0, 15)) {
        try {
          const res = await fetch(`/api/threads/comments?threadId=${post.threadId}&brand=${brand}`);
          const data = await res.json();
          if (res.ok && data.comments?.length > 0) {
            postsData.push({
              text: post.text,
              comments: data.comments.map((c: CommentData) => ({ username: c.username, text: c.text })),
            });
          }
        } catch {}
      }

      if (postsData.length === 0) {
        setInsightsError("분석할 댓글이 없습니다");
        setInsightsLoading(false);
        return;
      }

      const res = await fetch("/api/threads/comments/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posts: postsData, brand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "분석 실패");
      setInsights(data.insights);
    } catch (e: any) {
      setInsightsError(`인사이트 분석 실패: ${e.message}`);
    } finally {
      setInsightsLoading(false);
    }
  };

  // 인라인 글 생성
  const inlineGenerate = async () => {
    if (!inlineGenTopic?.trim()) return;
    setInlineGenLoading(true);
    setInlineGenError(null);
    setInlineGenPosts([]);
    try {
      const res = await fetch("/api/threads/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: inlineGenTopic,
          style: inlineGenStyle,
          count: 5,
          brand,
          length: inlineGenLength,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 실패");
      setInlineGenPosts(data.posts ?? []);
    } catch (e: any) {
      setInlineGenError(e.message);
    } finally {
      setInlineGenLoading(false);
    }
  };

  const saveInlinePost = (post: any) => {
    addPosts([post], brand);
  };

  // 직접 작성 → 큐 추가 (자동게시 또는 예약)
  const composeToQueue = async (scheduled?: boolean) => {
    if (!composeText.trim()) return;
    if (scheduled && (!scheduleDate || !scheduleTime)) {
      setComposeMsg("날짜와 시간을 선택해주세요");
      return;
    }
    setComposeQueuing(true);
    setComposeMsg(null);
    try {
      const body: any = { id: `manual_${Date.now()}`, text: composeText.trim(), brand };
      if (scheduled) {
        body.scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00+09:00`).toISOString();
      }
      const res = await fetch("/api/threads/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "큐 추가 실패");
      if (scheduled) {
        setComposeMsg(`${scheduleDate} ${scheduleTime}에 예약 완료`);
      } else {
        setComposeMsg("자동게시 큐에 추가 완료");
      }
      setComposeText("");
      setScheduleDate("");
      setScheduleTime("");
      setTimeout(() => setComposeMsg(null), 4000);
    } catch (e: any) {
      setComposeMsg(`실패: ${e.message}`);
    } finally {
      setComposeQueuing(false);
    }
  };

  // 직접 작성 → 즉시 게시
  const composePublishNow = async () => {
    if (!composeText.trim()) return;
    setComposePublishing(true);
    setComposeMsg(null);
    try {
      const res = await fetch("/api/threads/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: composeText.trim(), brand }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "게시 실패");
      setComposeMsg("게시 완료!");
      setComposeText("");
      setTimeout(() => { setComposeMsg(null); fetchPosts(); }, 2000);
    } catch (e: any) {
      setComposeMsg(`게시 실패: ${e.message}`);
    } finally {
      setComposePublishing(false);
    }
  };

  const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
  const totalReplies = posts.reduce((s, p) => s + p.replies, 0);
  const avgLikes = posts.length > 0 ? (totalLikes / posts.length).toFixed(1) : "0";
  const bestPost = posts.length > 0 ? posts.reduce((best, p) => p.likes > best.likes ? p : best, posts[0]) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 text-center py-16">
        <Send size={40} className="mx-auto mb-3 text-zinc-200 dark:text-zinc-700" />
        <p className="text-zinc-400 mb-2">{error}</p>
        <a
          href="/api/threads/auth/login"
          className="inline-flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold rounded-xl px-5 py-2.5 text-sm transition-colors hover:bg-zinc-700 dark:hover:bg-zinc-300"
        >
          <Send size={13} />
          Threads 연결하기
        </a>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 text-center py-16">
        <BarChart2 size={40} className="mx-auto mb-3 text-zinc-200 dark:text-zinc-700" />
        <p className="text-zinc-400 mb-1">게시된 글이 없습니다</p>
        <p className="text-xs text-zinc-300 dark:text-zinc-600">&quot;글 생성&quot; 탭에서 글을 게시하면 여기에 표시됩니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: "게시 글", value: posts.length, suffix: "개", color: "text-blue-500" },
          { label: "총 좋아요", value: totalLikes, suffix: "", color: "text-rose-500" },
          { label: "총 댓글", value: totalReplies, suffix: "", color: "text-violet-500" },
          { label: "평균 좋아요", value: avgLikes, suffix: "", color: "text-emerald-500" },
        ].map(({ label, value, suffix, color }) => (
          <div key={label} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-3 sm:p-4">
            <p className="text-[11px] sm:text-xs text-zinc-400 mb-1">{label}</p>
            <p className={`text-lg sm:text-xl font-bold ${color}`}>
              {typeof value === "number" ? value.toLocaleString("ko-KR") : value}
              {suffix && <span className="text-sm font-normal text-zinc-400 ml-0.5">{suffix}</span>}
            </p>
          </div>
        ))}
      </div>

      {/* 베스트 글 */}
      {bestPost && bestPost.likes > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-amber-500" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">베스트 게시물</span>
            <span className="text-xs text-amber-500 ml-auto">❤️ {bestPost.likes} · 💬 {bestPost.replies}</span>
          </div>
          <p className="text-sm text-amber-900 dark:text-amber-100 whitespace-pre-line line-clamp-3">{bestPost.text}</p>
        </div>
      )}

      {/* 액션 바 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCompose(!showCompose)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              showCompose
                ? "bg-violet-600 text-white"
                : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300"
            }`}
          >
            <PenLine size={13} />
            직접 작성
          </button>
          <button
            onClick={analyzeCommentInsights}
            disabled={insightsLoading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-400 disabled:opacity-50 transition-colors"
          >
            {insightsLoading ? <Loader2 size={13} className="animate-spin" /> : <Lightbulb size={13} />}
            {insightsLoading ? "분석 중..." : "댓글 인사이트"}
          </button>
        </div>
        <button
          onClick={fetchPosts}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <RefreshCw size={12} />
          새로고침
        </button>
      </div>

      {/* 직접 작성 패널 */}
      {showCompose && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
          <textarea
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            placeholder="쓰레드에 올릴 글을 직접 작성하세요..."
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 min-h-[100px]"
            rows={4}
          />
          {/* 예약 날짜/시간 */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 text-zinc-700 dark:text-zinc-300"
            />
            <input
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 text-zinc-700 dark:text-zinc-300"
            />
            <button
              onClick={() => composeToQueue(true)}
              disabled={!composeText.trim() || composeQueuing || !scheduleDate || !scheduleTime}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {composeQueuing ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
              예약 게시
            </button>
          </div>

          {/* 하단 액션 */}
          <div className="flex items-center justify-between mt-3">
            <span className="text-[11px] text-zinc-400">{composeText.length}자</span>
            <div className="flex items-center gap-2">
              {composeMsg && (
                <span className={`text-[11px] font-medium ${composeMsg.startsWith("실패") ? "text-red-500" : "text-emerald-500"}`}>
                  {composeMsg}
                </span>
              )}
              <button
                onClick={() => composeToQueue(false)}
                disabled={!composeText.trim() || composeQueuing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 transition-colors"
              >
                <CalendarClock size={12} />
                자동게시 큐
              </button>
              <button
                onClick={composePublishNow}
                disabled={!composeText.trim() || composePublishing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
              >
                {composePublishing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                즉시 게시
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 인사이트 결과 */}
      {insightsError && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-xl px-4 py-3">{insightsError}</p>
      )}
      {insights && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
          {/* 요약 */}
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb size={14} className="text-amber-500" />
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">댓글 인사이트</span>
              <button onClick={() => setInsights(null)} className="ml-auto text-zinc-300 hover:text-zinc-500 transition-colors">
                <X size={14} />
              </button>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{insights.summary}</p>
          </div>

          {/* 관심 주제 */}
          {insights.themes?.length > 0 && (
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-xs font-semibold text-zinc-500 mb-2">팔로워 관심 주제</p>
              <div className="space-y-2">
                {insights.themes.map((t: any, i: number) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-xs font-bold text-violet-500 bg-violet-50 dark:bg-violet-950/30 px-2 py-0.5 rounded-full flex-shrink-0">{t.count}</span>
                    <div>
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t.theme}</p>
                      {t.examples?.map((ex: string, j: number) => (
                        <p key={j} className="text-[11px] text-zinc-400 mt-0.5">&ldquo;{ex}&rdquo;</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 자주 묻는 질문 */}
          {insights.questions?.length > 0 && (
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-xs font-semibold text-zinc-500 mb-2">팔로워들이 궁금해하는 것</p>
              <ul className="space-y-1">
                {insights.questions.map((q: string, i: number) => (
                  <li key={i} className="text-sm text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                    <MessageCircle size={12} className="text-blue-400 mt-0.5 flex-shrink-0" />
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 감정 분석 */}
          {insights.sentiments && (
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-xs font-semibold text-zinc-500 mb-2">반응 패턴</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] sm:text-xs">
                {insights.sentiments.positive && (
                  <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-2.5">
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 mb-1">긍정</p>
                    <p className="text-zinc-600 dark:text-zinc-400">{insights.sentiments.positive}</p>
                  </div>
                )}
                {insights.sentiments.curious && (
                  <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-2.5">
                    <p className="font-semibold text-blue-600 dark:text-blue-400 mb-1">궁금</p>
                    <p className="text-zinc-600 dark:text-zinc-400">{insights.sentiments.curious}</p>
                  </div>
                )}
                {insights.sentiments.requests && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 rounded-lg p-2.5">
                    <p className="font-semibold text-amber-600 dark:text-amber-400 mb-1">요청</p>
                    <p className="text-zinc-600 dark:text-zinc-400">{insights.sentiments.requests}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 콘텐츠 아이디어 */}
          {insights.contentIdeas?.length > 0 && (
            <div className="p-4">
              <p className="text-xs font-semibold text-zinc-500 mb-3">추천 콘텐츠 아이디어</p>
              <div className="space-y-3">
                {insights.contentIdeas.map((idea: any, i: number) => (
                  <div key={i} className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-3">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{idea.topic}</p>
                    <p className="text-[11px] text-zinc-400 mt-1">{idea.why}</p>
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full">{idea.style}</span>
                        {idea.hook && <span className="text-[10px] text-zinc-400 italic line-clamp-1">&ldquo;{idea.hook}&rdquo;</span>}
                      </div>
                      <button
                        onClick={() => {
                          setInlineGenTopic(idea.topic);
                          setInlineGenStyle(STYLES.includes(idea.style) ? idea.style as PostStyle : "공감형");
                          setInlineGenPosts([]);
                          setInlineGenError(null);
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors flex-shrink-0 ${
                          inlineGenTopic === idea.topic
                            ? "bg-violet-600 text-white"
                            : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300"
                        }`}
                      >
                        <PenLine size={11} />
                        {inlineGenTopic === idea.topic ? "선택됨" : "글 생성"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 인라인 글 생성 패널 */}
      {inlineGenTopic && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-violet-200 dark:border-violet-800 overflow-hidden">
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <PenLine size={14} className="text-violet-500" />
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">글 생성</span>
              </div>
              <button onClick={() => { setInlineGenTopic(null); setInlineGenPosts([]); }} className="text-zinc-300 hover:text-zinc-500">
                <X size={16} />
              </button>
            </div>

            {/* 주제 (편집 가능) */}
            <input
              value={inlineGenTopic}
              onChange={(e) => setInlineGenTopic(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />

            {/* 스타일 + 길이 */}
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
              {STYLES.map((s) => (
                <button key={s} onClick={() => setInlineGenStyle(s)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                    inlineGenStyle === s
                      ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              {([
                { id: "short" as const, label: "짧게" },
                { id: "medium" as const, label: "보통" },
                { id: "long" as const, label: "길게" },
              ]).map((l) => (
                <button key={l.id} onClick={() => setInlineGenLength(l.id)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    inlineGenLength === l.id
                      ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <button
              onClick={inlineGenerate}
              disabled={inlineGenLoading}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50"
            >
              {inlineGenLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {inlineGenLoading ? "생성 중..." : "글 5개 생성"}
            </button>
            {inlineGenError && <p className="text-xs text-red-500 mt-2">{inlineGenError}</p>}
          </div>

          {/* 생성된 글 목록 */}
          {inlineGenPosts.length > 0 && (
            <div className="p-4 space-y-3">
              {inlineGenPosts.map((p: any, i: number) => (
                <InlinePostCard key={i} post={p} index={i} brand={brand} onSave={saveInlinePost} onCopy={copy} copiedId={copiedId} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 게시물 목록 */}
      <div className="space-y-3">
        {posts.map((post) => {
          const isExpanded = expandedPostId === post.threadId;
          const unrepliedComments = comments.filter(c => !c.hasReplied && !postedCommentIds.has(c.id));
          const pendingReplies = generatedReplies.filter(r => {
            const comment = unrepliedComments.find(c => c.username === r.username);
            return comment && !postedCommentIds.has(comment.id);
          });

          return (
            <div key={post.threadId} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
              {/* 게시물 행 */}
              <div className="flex items-start gap-3 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line line-clamp-2">{post.text}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-zinc-400">
                    <span>❤️ <span className={`font-semibold ${post.likes >= 30 ? "text-rose-500" : ""}`}>{post.likes}</span></span>
                    <span>💬 <span className={`font-semibold ${post.replies >= 20 ? "text-violet-500" : ""}`}>{post.replies}</span></span>
                    <span>{new Date(post.publishedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</span>
                    {post.permalink && (
                      <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                        <Link2 size={12} />
                      </a>
                    )}
                  </div>
                </div>
                {post.replies > 0 && (
                  <button
                    onClick={() => fetchComments(post.threadId)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isExpanded
                        ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    <MessageCircle size={12} />
                    댓글 관리
                    {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                )}
              </div>

              {/* 댓글 패널 */}
              {isExpanded && (
                <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-4 space-y-4">
                  {commentsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 size={18} className="animate-spin text-zinc-400" />
                      <span className="ml-2 text-sm text-zinc-400">댓글 불러오는 중...</span>
                    </div>
                  ) : comments.length === 0 ? (
                    <p className="text-sm text-zinc-400 text-center py-4">댓글이 없습니다</p>
                  ) : (
                    <>
                      {/* 댓글 목록 */}
                      <div className="space-y-2">
                        {comments.map((comment) => {
                          const isPosted = comment.hasReplied || postedCommentIds.has(comment.id);
                          const reply = generatedReplies.find(r => r.username === comment.username);
                          const isPosting = postingReplyId === comment.id;

                          return (
                            <div key={comment.id} className="space-y-2">
                              {/* 원본 댓글 */}
                              <div className={`rounded-xl p-3 ${isPosted ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800" : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">@{comment.username}</span>
                                  <span className="text-[10px] text-zinc-400">
                                    {new Date(comment.timestamp).toLocaleDateString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                  {isPosted && (
                                    <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 ml-auto">
                                      <CheckCircle2 size={10} />
                                      답글 완료
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-zinc-600 dark:text-zinc-400">{comment.text}</p>
                              </div>

                              {/* 대댓글 영역 (AI 생성 또는 직접 작성) */}
                              {!isPosted && (
                                <div className="ml-3 sm:ml-6 flex items-start gap-2">
                                  <CornerDownRight size={14} className={`${reply ? "text-violet-400" : "text-zinc-300 dark:text-zinc-600"} mt-2 flex-shrink-0`} />
                                  {reply ? (
                                    /* AI 생성 대댓글 */
                                    <div className="flex-1 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-xl p-3">
                                      <div className="flex items-center gap-2 mb-2">
                                        <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400">AI 대댓글</span>
                                        <Pencil size={10} className="text-violet-400" />
                                      </div>
                                      <textarea
                                        value={editedReplies[reply.commentIndex] ?? reply.reply}
                                        onChange={(e) => setEditedReplies(prev => ({ ...prev, [reply.commentIndex]: e.target.value }))}
                                        className="w-full text-sm bg-transparent border-0 outline-none resize-none text-zinc-700 dark:text-zinc-300 min-h-[40px]"
                                        rows={2}
                                      />
                                      <div className="flex justify-end mt-2">
                                        <button
                                          onClick={() => postReply(comment.id, reply.commentIndex)}
                                          disabled={isPosting}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                                        >
                                          {isPosting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                          게시
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    /* 직접 작성 + AI 다듬기 */
                                    <div className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3">
                                      <textarea
                                        value={manualDrafts[comment.id] ?? ""}
                                        onChange={(e) => setManualDrafts(prev => ({ ...prev, [comment.id]: e.target.value }))}
                                        placeholder="직접 대댓글을 작성하세요..."
                                        className="w-full text-sm bg-transparent border-0 outline-none resize-none text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-300 dark:placeholder:text-zinc-600 min-h-[40px]"
                                        rows={2}
                                      />
                                      <div className="flex justify-end gap-2 mt-2">
                                        {(manualDrafts[comment.id] ?? "").trim() && (
                                          <button
                                            onClick={() => polishDraft(comment.id, manualDrafts[comment.id], comment.text, post.text)}
                                            disabled={polishingId === comment.id}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                                          >
                                            {polishingId === comment.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                            AI 다듬기
                                          </button>
                                        )}
                                        <button
                                          onClick={() => postManualReply(comment.id)}
                                          disabled={isPosting || !(manualDrafts[comment.id] ?? "").trim()}
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                                        >
                                          {isPosting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                                          게시
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* 하단 액션 버튼 */}
                      <div className="flex flex-col gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                        {replyError && (
                          <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg px-3 py-2">{replyError}</p>
                        )}
                        <div className="flex items-center gap-2">
                        {comments.filter(c => !postedCommentIds.has(c.id)).length > 0 && (
                          <button
                            onClick={() => { setGeneratedReplies([]); setEditedReplies({}); generateReplies(post.text); }}
                            disabled={generatingReplies}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
                          >
                            {generatingReplies ? <Loader2 size={13} className="animate-spin" /> : generatedReplies.length > 0 ? <RefreshCw size={13} /> : <Sparkles size={13} />}
                            {generatedReplies.length > 0 ? "다시 생성" : `AI 대댓글 생성 (${comments.filter(c => !postedCommentIds.has(c.id)).length}개)`}
                          </button>
                        )}
                        {pendingReplies.length > 1 && (
                          <button
                            onClick={postAllReplies}
                            disabled={!!postingReplyId}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                          >
                            {postingReplyId ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                            전체 게시 ({pendingReplies.length}개)
                          </button>
                        )}
                        {comments.length > 0 && comments.filter(c => !postedCommentIds.has(c.id)).length === 0 && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            모든 댓글에 답글 완료
                          </p>
                        )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 디버그 정보 */}
      {debugInfo && debugInfo.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-3">
          <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">Insights API 오류</p>
          {debugInfo.map((msg, i) => (
            <p key={i} className="text-[11px] text-red-500 dark:text-red-400 break-all">{msg}</p>
          ))}
        </div>
      )}

      {/* 안내 */}
      <p className="text-[11px] text-zinc-400 text-center">
        최근 15일 이내 게시물 · 좋아요 30+ 또는 댓글 20+ 시 이메일 알림 발송
      </p>
    </div>
  );
}

// ── 섹션 래퍼 ─────────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={16} className="text-zinc-600 dark:text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export default function ThreadsStudio({ initialBrand = "paulvice" }: { initialBrand?: BrandId }) {
  const [tab, setTab]       = useState<Tab>("generate");
  const [postsCount, setPostsCount] = useState(0);
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [postsPerDay, setPostsPerDay] = useState<number | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const brand = initialBrand;
  const brandConfig = BRANDS[brand];

  useEffect(() => {
    migrateOldKeys();
    setPostsCount(loadPosts(brand).length);
    fetch(`/api/threads/status?brand=${brand}`)
      .then(r => r.json())
      .then(d => setMetaConnected(d.connected ?? false))
      .catch(() => setMetaConnected(false));
    fetch("/api/threads/queue")
      .then(r => r.json())
      .then(d => {
        const brandQueue = (d.queue ?? []).filter((q: any) => (q.brand ?? "paulvice") === brand);
        setQueueCount(brandQueue.length);
      })
      .catch(() => setQueueCount(0));
    fetch("/api/threads/settings")
      .then(r => r.json())
      .then(d => {
        const s = d.settings?.[brand];
        setPostsPerDay(s?.postsPerDay ?? (brand === "hongsungjo" ? 2 : 8));
      })
      .catch(() => setPostsPerDay(brand === "hongsungjo" ? 2 : 8));
  }, [brand]);

  const updatePostsPerDay = async (value: number) => {
    const clamped = Math.max(0, Math.min(12, value));
    setPostsPerDay(clamped);
    setSettingsSaving(true);
    try {
      await fetch("/api/threads/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, postsPerDay: clamped }),
      });
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-3 py-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">

        {/* 헤더 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-zinc-900 dark:bg-zinc-100 rounded-xl flex items-center justify-center text-white dark:text-zinc-900 flex-shrink-0">
              <ThreadsLogo size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-zinc-800 dark:text-zinc-100 truncate">{brandConfig.emoji} {brandConfig.name}</h1>
              <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5">트렌드 · 레퍼런스 · 글 생성 · 게시 관리</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {metaConnected === false && (
              <a
                href={`/api/threads/auth/login?brand=${brand}`}
                className="flex items-center gap-1.5 text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 px-3 sm:px-4 py-2 rounded-xl transition-colors"
              >
                <Send size={13} />
                <span className="hidden sm:inline">{brandConfig.name}</span> 연결
              </a>
            )}
            {metaConnected === true && (
              <>
                <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-1 rounded-lg">
                  <Check size={10} /> <span className="hidden sm:inline">게시 가능</span>
                </span>
                <a
                  href={`/api/threads/auth/login?brand=${brand}`}
                  className="hidden sm:flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <RefreshCw size={10} /> 재인증
                </a>
              </>
            )}
          </div>
        </div>

        {/* 큐 상태 + 게시 설정 */}
        {queueCount !== null && postsPerDay !== null && (() => {
          const dailyTarget = postsPerDay;
          const isLow = dailyTarget > 0 && queueCount < dailyTarget;
          const isPaused = dailyTarget === 0;
          return (
            <div className="space-y-2">
              <div className={`flex items-center justify-between rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm ${
                isPaused
                  ? "bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  : isLow
                    ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"
                    : "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800"
              }`}>
                <div className="flex items-center gap-2">
                  <CalendarClock size={14} className={isPaused ? "text-zinc-400" : isLow ? "text-amber-500" : "text-emerald-500"} />
                  <span className={isPaused ? "text-zinc-500 dark:text-zinc-400" : isLow ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}>
                    {isPaused ? (
                      <>자동 게시 <b>일시정지</b> 중</>
                    ) : (
                      <>
                        자동 게시 대기: <b>{queueCount}개</b>
                        {isLow && ` — 하루 ${dailyTarget}회 게시에 글이 부족합니다.`}
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!isPaused && (
                    <span className={`text-xs font-medium ${isLow ? "text-amber-500" : "text-emerald-500"}`}>
                      {dailyTarget > 0 && queueCount >= dailyTarget ? `${Math.floor(queueCount / dailyTarget)}일분` : "부족"}
                    </span>
                  )}
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    title="게시 설정"
                  >
                    <Settings size={14} className="text-zinc-400" />
                  </button>
                </div>
              </div>

              {showSettings && (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">하루 자동 게시 횟수</p>
                      <p className="text-xs text-zinc-400 mt-0.5">0으로 설정하면 자동 게시가 일시정지됩니다</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updatePostsPerDay(postsPerDay - 1)}
                        disabled={postsPerDay <= 0 || settingsSaving}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-10 text-center text-lg font-bold text-zinc-800 dark:text-zinc-100">
                        {settingsSaving ? <Loader2 size={16} className="animate-spin mx-auto text-zinc-400" /> : postsPerDay}
                      </span>
                      <button
                        onClick={() => updatePostsPerDay(postsPerDay + 1)}
                        disabled={postsPerDay >= 12 || settingsSaving}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                      <span className="text-xs text-zinc-400 ml-1">회/일</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* 브랜드 네비게이션 */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {[
            { id: "dashboard", name: "대시보드", emoji: "📊" },
            ...BRAND_LIST.map(b => ({ id: b.id, name: b.name, emoji: b.emoji })),
          ].map((b) => (
            <a
              key={b.id}
              href={`/tools/threads?brand=${b.id}`}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                brand === b.id
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm"
                  : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300"
              }`}
            >
              <span>{b.emoji}</span>
              <span>{b.name}</span>
            </a>
          ))}
        </div>

        {/* 탭 */}
        <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 sm:p-1.5 rounded-2xl">
          {([
            { tab: "generate" as Tab, label: "글 생성", icon: PenLine, badge: postsCount },
            { tab: "published" as Tab, label: "게시 관리", icon: BarChart2, badge: 0 },
          ]).map(({ tab: t, label, icon: Icon, badge }) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                tab === t
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              <Icon size={14} />
              {label}
              {!!badge && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === t ? "bg-white/20 dark:bg-zinc-900/30" : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500"}`}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        {tab === "generate"  && <GenerateTab onPostsChange={setPostsCount} brand={brand} />}
        {tab === "published" && <PublishedTab brand={brand} />}

      </div>
    </div>
  );
}
