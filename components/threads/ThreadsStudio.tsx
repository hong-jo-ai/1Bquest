"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp, BookmarkPlus, PenLine, RefreshCw, Copy, Trash2,
  Heart, ChevronDown, ChevronUp, Loader2, Link2, Sparkles,
  X, Check, BarChart2, Lightbulb, MessageCircle, Zap, Send,
  ImagePlus, Film, Clock, CalendarClock, Pencil,
} from "lucide-react";
import {
  loadRefs, addRef, deleteRef,
  loadPosts, addPosts, toggleLike, deletePost, updatePostText, updatePostMedia, removePostMedia,
  loadTrend, saveTrend, migrateOldKeys,
  type ThreadsRef, type GeneratedPost, type TrendAnalysis,
  type ThreadsCategory, type PostStyle,
} from "@/lib/threadsStorage";
import { BRANDS, BRAND_LIST, type BrandId } from "@/lib/threadsBrands";

type Tab = "trend" | "refs" | "generate" | "published";

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
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
        active
          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm"
          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      <Icon size={15} />
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
  const [useRefs, setUseRefs]   = useState(false);
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

    let references: string[] = [];
    if (useRefs) {
      const refs = loadRefs(brand);
      references = refs.slice(0, 5).map((r) => r.text);
    }

    try {
      const res  = await fetch("/api/threads/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, style, count: 5, references, customContext: customCtx, brand }),
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

        {/* 레퍼런스 활용 */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input type="checkbox" checked={useRefs} onChange={(e) => setUseRefs(e.target.checked)}
            className="w-4 h-4 rounded accent-zinc-900" />
          <span className="text-xs text-zinc-600 dark:text-zinc-400">수집한 레퍼런스 글 참고해서 생성 (최대 5개)</span>
        </label>

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

function SavedPostCard({ post, onLike, onDelete, onCopy, copied, brand }: {
  post: GeneratedPost; onLike: () => void; onDelete: () => void;
  onCopy: () => void; copied: boolean; brand: BrandId;
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
    setUploading(true);
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

function PublishedTab() {
  const [posts, setPosts] = useState<PublishedPostMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/threads/published");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "조회 실패");
      setPosts(data.posts ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

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
        <p className="text-xs text-zinc-300 dark:text-zinc-600">"글 생성" 탭에서 글을 게시하면 여기에 표시됩니다</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "게시 글", value: posts.length, suffix: "개", color: "text-blue-500" },
          { label: "총 좋아요", value: totalLikes, suffix: "", color: "text-rose-500" },
          { label: "총 댓글", value: totalReplies, suffix: "", color: "text-violet-500" },
          { label: "평균 좋아요", value: avgLikes, suffix: "", color: "text-emerald-500" },
        ].map(({ label, value, suffix, color }) => (
          <div key={label} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
            <p className="text-xs text-zinc-400 mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>
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

      {/* 새로고침 */}
      <div className="flex justify-end">
        <button
          onClick={fetchPosts}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <RefreshCw size={12} />
          새로고침
        </button>
      </div>

      {/* 게시물 목록 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                <th className="text-left px-4 py-3 font-medium text-zinc-500">게시물</th>
                <th className="text-center px-3 py-3 font-medium text-zinc-500 w-20">❤️</th>
                <th className="text-center px-3 py-3 font-medium text-zinc-500 w-20">💬</th>
                <th className="text-center px-3 py-3 font-medium text-zinc-500 w-24">게시일</th>
                <th className="text-center px-3 py-3 font-medium text-zinc-500 w-16">링크</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.threadId} className="border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                  <td className="px-4 py-3">
                    <p className="text-zinc-700 dark:text-zinc-300 whitespace-pre-line line-clamp-2 max-w-[360px]">{post.text}</p>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`font-semibold ${post.likes >= 30 ? "text-rose-500" : "text-zinc-500"}`}>
                      {post.likes}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`font-semibold ${post.replies >= 20 ? "text-violet-500" : "text-zinc-500"}`}>
                      {post.replies}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center text-xs text-zinc-400">
                    {new Date(post.publishedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {post.permalink ? (
                      <a
                        href={post.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                      >
                        <Link2 size={14} />
                      </a>
                    ) : (
                      <span className="text-zinc-200 dark:text-zinc-700">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
  const router = useRouter();
  const [tab, setTab]       = useState<Tab>("trend");
  const [refsCount, setRefsCount]   = useState(0);
  const [postsCount, setPostsCount] = useState(0);
  const [metaConnected, setMetaConnected] = useState<boolean | null>(null);
  const brand = initialBrand;
  const brandConfig = BRANDS[brand];

  useEffect(() => {
    migrateOldKeys();
    setRefsCount(loadRefs(brand).length);
    setPostsCount(loadPosts(brand).length);
    fetch(`/api/threads/status?brand=${brand}`)
      .then(r => r.json())
      .then(d => setMetaConnected(d.connected ?? false))
      .catch(() => setMetaConnected(false));
  }, [brand]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 dark:bg-zinc-100 rounded-xl flex items-center justify-center text-white dark:text-zinc-900">
              <ThreadsLogo size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">Threads 콘텐츠 스튜디오</h1>
              <p className="text-xs text-zinc-400 mt-0.5">바이럴 트렌드 분석 · 레퍼런스 수집 · 글 생성</p>
            </div>
          </div>
          {metaConnected === false && (
            <a
              href={`/api/threads/auth/login?brand=${brand}`}
              className="flex items-center gap-1.5 text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 px-4 py-2 rounded-xl transition-colors"
            >
              <Send size={13} />
              {brandConfig.name} Threads 연결
            </a>
          )}
          {metaConnected === true && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-1.5 rounded-xl">
              <Check size={12} /> Threads 게시 가능
            </span>
          )}
        </div>

        {/* 브랜드 선택 */}
        <div className="flex gap-2">
          {BRAND_LIST.map((b) => (
            <button
              key={b.id}
              onClick={() => router.push(`/tools/threads?brand=${b.id}`)}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                brand === b.id
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm"
                  : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300"
              }`}
            >
              <span>{b.emoji}</span>
              <span>{b.name}</span>
            </button>
          ))}
        </div>

        {/* 탭 */}
        <div className="flex gap-2 bg-zinc-100 dark:bg-zinc-800 p-1.5 rounded-2xl overflow-x-auto">
          <TabBtn tab="trend"     active={tab === "trend"}     label="트렌드 분석"  icon={TrendingUp}   onClick={() => setTab("trend")} />
          <TabBtn tab="refs"      active={tab === "refs"}      label="레퍼런스 수집" icon={BookmarkPlus} badge={refsCount}   onClick={() => setTab("refs")} />
          <TabBtn tab="generate"  active={tab === "generate"}  label="글 생성"      icon={PenLine}      badge={postsCount}  onClick={() => setTab("generate")} />
          <TabBtn tab="published" active={tab === "published"} label="게시 관리"    icon={BarChart2}    onClick={() => setTab("published")} />
        </div>

        {/* 탭 콘텐츠 */}
        {tab === "trend"     && <TrendTab brand={brand} />}
        {tab === "refs"      && <RefsTab  onRefsChange={setRefsCount} brand={brand} />}
        {tab === "generate"  && <GenerateTab onPostsChange={setPostsCount} brand={brand} />}
        {tab === "published" && <PublishedTab />}

      </div>
    </div>
  );
}
