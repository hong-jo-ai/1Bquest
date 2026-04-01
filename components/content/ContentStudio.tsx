"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Clapperboard, TrendingUp, RefreshCw, Copy, Trash2, Check,
  Loader2, Sparkles, ChevronDown, ChevronUp, Camera, Package,
  Layers, History, ArrowRight, Lightbulb, Film, Hash,
  MessageSquare, CheckSquare, Repeat2, Download,
} from "lucide-react";
import {
  loadBriefs, addBrief, deleteBrief, updateBriefHook, analyzeHistory,
  loadTrendCache, saveTrendCache, syncBriefsFromServer,
  type ContentBrief, type ContentType, type Channel, type Emotion, type TrendCache,
  CHANNEL_LABEL, CHANNEL_DURATION, CONTENT_TYPE_COLORS,
} from "@/lib/contentStorage";

// ── 상수 ──────────────────────────────────────────────────────────────────

const PRODUCTS = ["미니엘 쁘띠 사각 워치", "에골라 오벌 워치", "오드리 워치", "폴바이스 전 제품", "각인 서비스"];
const SEASONS  = ["봄 신상", "졸업·입학 시즌", "화이트데이", "여름 코디", "가을 무드", "크리스마스·연말", "발렌타인데이", "일상/시즌 무관"];
const EMOTIONS: Emotion[] = ["감성적", "실용적", "트렌디", "따뜻한", "세련된", "공감형"];
const CHANNELS: Channel[] = ["reels", "youtube_shorts", "instagram_feed", "threads"];
const CONTENT_TYPES: ContentType[] = ["제품소개", "스타일링", "스토리텔링", "비하인드", "튜토리얼", "시즌이슈"];

const CHANNEL_ICONS: Record<Channel, string> = {
  reels: "🎬", youtube_shorts: "▶️", instagram_feed: "📷", threads: "@",
};

type Tab = "generate" | "convert" | "trends" | "history";

// ── 공통 훅 ───────────────────────────────────────────────────────────────

function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };
  return { copiedId, copy };
}

// ── 섹션 카드 ─────────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children, defaultOpen = true }: {
  title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-zinc-500" />
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</span>
        </div>
        {open ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 탭 1 · 기획서 생성
// ────────────────────────────────────────────────────────────────

function GenerateTab({ onSaved }: { onSaved: () => void }) {
  const [product, setProduct]       = useState(PRODUCTS[0]);
  const [season, setSeason]         = useState(SEASONS[0]);
  const [emotion, setEmotion]       = useState<Emotion>("감성적");
  const [channels, setChannels]     = useState<Channel[]>(["reels"]);
  const [contentType, setContentType] = useState<ContentType>("스타일링");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [brief, setBrief]           = useState<ContentBrief | null>(null);
  const [selectedHook, setSelectedHook] = useState(0);
  const [trendCache, setTrendCache] = useState<TrendCache | null>(null);
  const { copiedId, copy }          = useCopy();

  useEffect(() => { setTrendCache(loadTrendCache()); }, []);

  const toggleChannel = (c: Channel) =>
    setChannels((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c]);

  const buildTrendContext = (cache: TrendCache) => {
    const lines: string[] = [];
    if (cache.viralHooks?.length)
      lines.push(`바이럴 훅 패턴: ${cache.viralHooks.slice(0, 4).map((h: any) => h.hook).join(" / ")}`);
    if (cache.trendingThemes?.length)
      lines.push(`인기 테마: ${cache.trendingThemes.slice(0, 3).map((t: any) => t.theme).join(", ")}`);
    if (cache.searchKeywords?.length)
      lines.push(`검색 키워드: ${cache.searchKeywords.slice(0, 5).map((k: any) => k.keyword).join(", ")}`);
    if (cache.contentFormats?.length)
      lines.push(`잘 되는 포맷: ${cache.contentFormats.slice(0, 3).map((f: any) => f.name).join(", ")}`);
    return lines.join("\n");
  };

  const generate = async () => {
    if (channels.length === 0) return;
    setLoading(true); setError(null); setBrief(null);
    const trendContext = trendCache ? buildTrendContext(trendCache) : undefined;
    try {
      const res  = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, season, emotion, channels, contentType, trendContext }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBrief({ ...data, id: crypto.randomUUID(), createdAt: new Date().toISOString(), selectedHook: 0 });
      setSelectedHook(0);
    } catch (e: any) {
      setError(e.message ?? "생성 실패");
    } finally {
      setLoading(false);
    }
  };

  const saveBrief = () => {
    if (!brief) return;
    addBrief({ ...brief, selectedHook });
    onSaved();
    alert("기획서가 저장됐습니다!");
  };

  const exportText = () => {
    if (!brief) return;
    const hook = brief.hooks[selectedHook];
    const cv   = brief.channelVersions ?? [];
    const text = [
      `═══ ${brief.title} ═══`,
      `제품: ${brief.product} | 시즌: ${brief.season} | 감성: ${brief.emotion} | 유형: ${brief.contentType}`,
      "",
      "── HOOK ──",
      `${hook.text}  (${hook.type})`,
      "",
      "── 대본 ──",
      `[도입] ${brief.script.intro}`,
      `[본론] ${brief.script.body}`,
      `[CTA]  ${brief.script.cta}`,
      "",
      "── 캡션 ──",
      brief.caption,
      "",
      brief.hashtags.join(" "),
      "",
      "── 촬영 체크리스트 ──",
      `착장: ${brief.checklist.styling.join(", ")}`,
      `소품: ${brief.checklist.props.join(", ")}`,
      `배경: ${brief.checklist.background.join(", ")}`,
      `장비: ${brief.checklist.equipment.join(", ")}`,
      "",
      ...cv.map((v) => [
        `── ${CHANNEL_LABEL[v.channel as Channel]} 대본 ──`,
        v.script, "",
      ].join("\n")),
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `폴바이스_기획서_${brief.title}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5 items-start">
      {/* 왼쪽: 입력 폼 */}
      <div className="space-y-4">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5 space-y-4">
          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">기획 조건 설정</p>

          {/* 제품 */}
          <FormField label="제품">
            <div className="flex flex-wrap gap-1.5">
              {PRODUCTS.map((p) => (
                <Chip key={p} active={product === p} onClick={() => setProduct(p)}>{p}</Chip>
              ))}
            </div>
          </FormField>

          {/* 시즌/이슈 */}
          <FormField label="시즌 / 이슈">
            <div className="flex flex-wrap gap-1.5">
              {SEASONS.map((s) => (
                <Chip key={s} active={season === s} onClick={() => setSeason(s)}>{s}</Chip>
              ))}
            </div>
          </FormField>

          {/* 감성 */}
          <FormField label="타깃 감성">
            <div className="flex flex-wrap gap-1.5">
              {EMOTIONS.map((e) => (
                <Chip key={e} active={emotion === e} onClick={() => setEmotion(e)}>{e}</Chip>
              ))}
            </div>
          </FormField>

          {/* 채널 */}
          <FormField label="채널 선택">
            <div className="grid grid-cols-2 gap-2">
              {CHANNELS.map((c) => (
                <button key={c} onClick={() => toggleChannel(c)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                    channels.includes(c)
                      ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                      : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400"
                  }`}>
                  <span>{CHANNEL_ICONS[c]}</span>
                  <span>{CHANNEL_LABEL[c]}</span>
                  <span className="opacity-60 text-[10px]">{CHANNEL_DURATION[c]}</span>
                </button>
              ))}
            </div>
          </FormField>

          {/* 콘텐츠 유형 */}
          <FormField label="콘텐츠 유형">
            <div className="flex flex-wrap gap-1.5">
              {CONTENT_TYPES.map((t) => (
                <Chip key={t} active={contentType === t} onClick={() => setContentType(t)}>{t}</Chip>
              ))}
            </div>
          </FormField>

          {/* 트렌드 반영 상태 */}
          {trendCache ? (
            <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2">
              <TrendingUp size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                <span className="font-semibold">최신 트렌드 반영 중</span>
                <span className="text-emerald-500 ml-1">· {new Date(trendCache.generatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 스캔</span>
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2">
              <TrendingUp size={13} className="text-zinc-400 shrink-0" />
              <p className="text-xs text-zinc-400">트렌드 스캔 결과 없음 — 스캔 후 생성하면 트렌드가 반영됩니다</p>
            </div>
          )}

          <button
            onClick={generate} disabled={loading || channels.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 text-sm font-bold py-3 rounded-xl transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {loading ? "AI가 기획서 작성 중..." : "기획서 생성"}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>

      {/* 오른쪽: 결과 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-zinc-400">
          <Loader2 size={32} className="animate-spin" />
          <div className="text-center">
            <p className="text-sm font-medium">AI가 기획서를 작성하고 있습니다</p>
            <p className="text-xs mt-1 opacity-70">훅 · 씬 구성 · 대본 · 캡션 · 체크리스트 생성 중...</p>
          </div>
        </div>
      ) : brief ? (
        <div className="space-y-4">
          {/* 저장/다운로드 */}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">{brief.title}</h2>
            <div className="flex gap-2">
              <button onClick={exportText} className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-1.5 rounded-xl transition-colors">
                <Download size={13} /> TXT 저장
              </button>
              <button onClick={saveBrief} className="flex items-center gap-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-xl transition-colors">
                <CheckSquare size={13} /> 히스토리 저장
              </button>
            </div>
          </div>

          {/* 훅 선택 */}
          <SectionCard title="훅 문구 3개 옵션" icon={Sparkles}>
            <div className="space-y-2">
              {brief.hooks.map((h, i) => (
                <button key={i} onClick={() => setSelectedHook(i)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    selectedHook === i
                      ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20"
                      : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"
                  }`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mr-2 ${
                        selectedHook === i ? "bg-violet-500 text-white" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                      }`}>{h.type}</span>
                      <p className="text-sm text-zinc-800 dark:text-zinc-100 mt-2 leading-relaxed">{h.text}</p>
                    </div>
                    {selectedHook === i && <Check size={16} className="text-violet-500 shrink-0 mt-1" />}
                  </div>
                </button>
              ))}
            </div>
          </SectionCard>

          {/* 씬 구성 */}
          <SectionCard title="촬영 씬 구성" icon={Camera}>
            <div className="space-y-3">
              {brief.scenes.map((s) => (
                <div key={s.order} className="flex gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
                  <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 text-xs font-bold flex items-center justify-center shrink-0">
                    {s.order}
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Tag color="blue">{s.angle}</Tag>
                      <Tag color="zinc">{s.duration}</Tag>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400"><span className="font-medium">배경:</span> {s.background}</p>
                    <div className="flex flex-wrap gap-1">
                      {s.props.map((p, i) => <Tag key={i} color="amber">{p}</Tag>)}
                    </div>
                    {s.note && <p className="text-[11px] text-zinc-400 italic">{s.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* 대본 */}
          <SectionCard title="촬영 대본 (도입→본론→CTA)" icon={MessageSquare}>
            <div className="space-y-3">
              {[
                { label: "도입", text: brief.script.intro, color: "bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800" },
                { label: "본론", text: brief.script.body,  color: "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700" },
                { label: "CTA", text: brief.script.cta,   color: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" },
              ].map(({ label, text, color }) => (
                <div key={label} className={`p-4 rounded-xl border ${color}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold text-zinc-500 mb-1.5">{label}</p>
                      <p className="text-sm text-zinc-800 dark:text-zinc-100 leading-relaxed whitespace-pre-wrap">{text}</p>
                    </div>
                    <button onClick={() => copy(text, `script_${label}`)}
                      className="p-1.5 rounded-lg hover:bg-white/60 text-zinc-400 shrink-0">
                      {copiedId === `script_${label}` ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => copy(`${brief.script.intro}\n\n${brief.script.body}\n\n${brief.script.cta}`, "script_all")}
              className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
              {copiedId === "script_all" ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              전체 대본 복사
            </button>
          </SectionCard>

          {/* 캡션 + 해시태그 */}
          <SectionCard title="캡션 + 해시태그" icon={Hash}>
            <div className="space-y-3">
              <div className="relative">
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
                  {brief.caption}
                </p>
                <button onClick={() => copy(brief.caption, "caption")}
                  className="absolute top-3 right-3 p-1.5 rounded-lg bg-white dark:bg-zinc-700 shadow-sm text-zinc-400">
                  {copiedId === "caption" ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {brief.hashtags.map((h, i) => (
                  <span key={i} className="text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">{h}</span>
                ))}
              </div>
              <button onClick={() => copy(brief.hashtags.join(" "), "hashtags")}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                {copiedId === "hashtags" ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                해시태그 전체 복사
              </button>
            </div>
          </SectionCard>

          {/* 채널별 버전 */}
          {brief.channelVersions && brief.channelVersions.length > 0 && (
            <SectionCard title="채널별 최적화 대본" icon={Layers}>
              <div className="space-y-4">
                {brief.channelVersions.map((v, i) => (
                  <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800">
                      <div className="flex items-center gap-2">
                        <span>{CHANNEL_ICONS[v.channel as Channel]}</span>
                        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{CHANNEL_LABEL[v.channel as Channel]}</span>
                        <span className="text-xs text-zinc-400">{CHANNEL_DURATION[v.channel as Channel]}</span>
                      </div>
                      <button onClick={() => copy(v.script, `cv_${i}`)}
                        className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                        {copiedId === `cv_${i}` ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                      </button>
                    </div>
                    <div className="p-4">
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{v.script}</p>
                      {v.notes && (
                        <p className="text-[11px] text-zinc-400 italic mt-3 border-t border-zinc-100 dark:border-zinc-800 pt-2">{v.notes}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* 촬영 체크리스트 */}
          <SectionCard title="촬영 당일 체크리스트" icon={CheckSquare}>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { icon: "👗", label: "착장",   items: brief.checklist.styling    },
                { icon: "🎁", label: "소품",   items: brief.checklist.props      },
                { icon: "🏞️", label: "배경/장소", items: brief.checklist.background },
                { icon: "📱", label: "장비·세팅", items: brief.checklist.equipment  },
              ].map(({ icon, label, items }) => (
                <div key={label} className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
                  <p className="text-xs font-bold text-zinc-500 mb-2">{icon} {label}</p>
                  <ul className="space-y-1.5">
                    {items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <span className="shrink-0 w-4 h-4 rounded border border-zinc-300 dark:border-zinc-600 mt-0.5" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-3">
          <Clapperboard size={40} className="opacity-20" />
          <p className="text-sm font-medium">왼쪽에서 조건을 설정하고 기획서를 생성하세요</p>
          <p className="text-xs opacity-60">훅 · 씬 구성 · 대본 · 캡션 · 체크리스트가 한 번에 생성됩니다</p>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 탭 2 · 채널 변환
// ────────────────────────────────────────────────────────────────

function ConvertTab() {
  const [idea, setIdea]         = useState("");
  const [channels, setChannels] = useState<Channel[]>(["reels", "youtube_shorts", "instagram_feed", "threads"]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [versions, setVersions] = useState<{
    channel: Channel; script: string; shootingNotes: string; duration: string; keyPoints: string[];
  }[]>([]);
  const { copiedId, copy } = useCopy();

  const convert = async () => {
    if (!idea.trim()) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/content/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, channels }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVersions(data.versions ?? []);
    } catch (e: any) {
      setError(e.message ?? "변환 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5 space-y-4">
        <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">핵심 아이디어 입력</p>
        <textarea rows={4} value={idea} onChange={(e) => setIdea(e.target.value)}
          placeholder={"예: 출근 전 아침에 시계 하나 차면 코디가 완성되는 느낌.\n폴바이스 에골라 오벌 워치를 착용하고 일상을 보여주는 콘텐츠."}
          className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 resize-none" />

        <div>
          <p className="text-xs text-zinc-500 mb-2">변환할 채널 선택</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CHANNELS.map((c) => (
              <button key={c} onClick={() => setChannels((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                  channels.includes(c)
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400"
                }`}>
                {CHANNEL_ICONS[c]} {CHANNEL_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <button onClick={convert} disabled={loading || !idea.trim() || channels.length === 0}
          className="flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-40">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Repeat2 size={15} />}
          {loading ? "채널별 변환 중..." : `${channels.length}개 채널로 변환`}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {versions.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {versions.map((v, i) => (
            <div key={i} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-700">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{CHANNEL_ICONS[v.channel]}</span>
                  <div>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{CHANNEL_LABEL[v.channel]}</p>
                    <p className="text-[10px] text-zinc-400">{v.duration}</p>
                  </div>
                </div>
                <button onClick={() => copy(v.script, `v${i}`)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                  {copiedId === `v${i}` ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">{v.script}</p>
                {v.keyPoints?.length > 0 && (
                  <ul className="space-y-1">
                    {v.keyPoints.map((kp, j) => (
                      <li key={j} className="text-xs text-zinc-500 flex items-start gap-1.5">
                        <Lightbulb size={10} className="shrink-0 mt-0.5 text-amber-400" />{kp}
                      </li>
                    ))}
                  </ul>
                )}
                {v.shootingNotes && (
                  <p className="text-[11px] text-zinc-400 italic border-t border-zinc-100 dark:border-zinc-800 pt-2">
                    {v.shootingNotes}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 탭 3 · 트렌드 스캔
// ────────────────────────────────────────────────────────────────

const TREND_SOURCE_META: Record<string, { label: string; activeColor: string }> = {
  youtube:   { label: "YouTube Shorts",    activeColor: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  naver:     { label: "Naver DataLab",     activeColor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  google:    { label: "Google Trends",     activeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  meta:      { label: "Instagram 인사이트", activeColor: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  webSearch: { label: "Claude 웹검색",     activeColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
};

function TrendsTab() {
  const [loading, setLoading]     = useState(false);
  const [data, setData]           = useState<any>(null);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);

  const scan = async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/content/trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: ["패션 시계", "여성 액세서리", "출근룩", "릴스 바이럴"] }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setData(d);
      saveTrendCache(d); // 기획서 생성에서 자동 활용
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">SNS 트렌드 스캔</p>
            <p className="text-xs text-zinc-400 mt-0.5">5개 소스 통합 분석 — YouTube · Naver · Google · Instagram · 웹검색</p>
          </div>
          {data && <p className="text-[11px] text-zinc-400">{new Date(data.generatedAt).toLocaleString("ko-KR")}</p>}
        </div>

        {/* 데이터 소스 상태 배지 */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {Object.entries(TREND_SOURCE_META).map(([key, meta]) => {
            const active = data?.sources?.[key]?.active ?? false;
            return (
              <span key={key} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors ${
                active ? meta.activeColor : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
              }`}>
                <span className={active ? "text-[8px]" : "text-[8px] opacity-50"}>●</span>
                {meta.label}
              </span>
            );
          })}
          {!data && <span className="text-[10px] text-zinc-400 dark:text-zinc-500 self-center ml-1">스캔 전 — API 키 설정된 소스만 활성화됩니다</span>}
        </div>

        <button onClick={scan} disabled={loading}
          className="flex items-center gap-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-40">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <TrendingUp size={15} />}
          {loading ? "트렌드 스캔 중..." : "지금 스캔하기"}
        </button>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>

      {data && (
        <>
          {/* 바이럴 훅 */}
          <TrendSection title="🔥 지금 먹히는 바이럴 훅" subtitle="인스타/유튜브에서 실제로 잘 되는 첫 문장 패턴">
            <div className="grid gap-2">
              {data.viralHooks?.map((h: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
                  <span className="text-[10px] font-bold bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full shrink-0 mt-0.5">{h.platform}</span>
                  <div>
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{h.hook}</p>
                    <p className="text-xs text-zinc-500 italic mt-0.5">예시: "{h.example}"</p>
                  </div>
                </div>
              ))}
            </div>
          </TrendSection>

          {/* 콘텐츠 포맷 */}
          <TrendSection title="📱 요즘 잘 되는 콘텐츠 포맷" subtitle="팔로워 늘리는 포맷 유형">
            <div className="space-y-3">
              {data.contentFormats?.map((f: any, i: number) => (
                <div key={i} className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                  <button onClick={() => setExpanded(expanded === `cf${i}` ? null : `cf${i}`)}
                    className="w-full flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <div>
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{f.name}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{f.desc}</p>
                    </div>
                    {expanded === `cf${i}` ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
                  </button>
                  {expanded === `cf${i}` && (
                    <div className="px-4 pb-4 space-y-2">
                      <p className="text-xs text-zinc-600 dark:text-zinc-400"><span className="font-medium">왜 잘 되나:</span> {f.whyWorks}</p>
                      <div className="flex items-start gap-2 bg-violet-50 dark:bg-violet-900/20 rounded-lg p-3">
                        <Lightbulb size={12} className="shrink-0 mt-0.5 text-violet-500" />
                        <p className="text-xs text-violet-700 dark:text-violet-300">{f.paulviceFit}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </TrendSection>

          {/* 인기 테마 */}
          <TrendSection title="🎯 폴바이스에 맞는 인기 테마" subtitle="지금 공감받는 주제들">
            <div className="grid sm:grid-cols-2 gap-3">
              {data.trendingThemes?.map((t: any, i: number) => (
                <div key={i} className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">{t.theme}</p>
                  <p className="text-xs text-zinc-500 mb-2">{t.insight}</p>
                  <div className="flex items-start gap-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-2.5 py-2">
                    <ArrowRight size={11} className="shrink-0 mt-0.5 text-emerald-500" />
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">{t.angle}</p>
                  </div>
                </div>
              ))}
            </div>
          </TrendSection>

          {/* SEO 키워드 */}
          <TrendSection title="🔍 노출 잘 되는 검색 키워드" subtitle="인스타/유튜브 검색 최적화">
            <div className="flex flex-wrap gap-2">
              {data.searchKeywords?.map((k: any, i: number) => (
                <div key={i} className="flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2">
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{k.keyword}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    k.difficulty === "상" ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                    : k.difficulty === "중" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                  }`}>{k.difficulty}</span>
                </div>
              ))}
            </div>
          </TrendSection>

          {/* 즉시 팁 */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300 mb-3">⚡ 바로 쓸 수 있는 팁</p>
            <ul className="space-y-2">
              {data.quickTips?.map((tip: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <span className="shrink-0 font-bold">{i + 1}.</span>{tip}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function TrendSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
      <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 mb-0.5">{title}</p>
      <p className="text-xs text-zinc-400 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// 탭 4 · 히스토리
// ────────────────────────────────────────────────────────────────

function HistoryTab({ refreshSignal }: { refreshSignal: number }) {
  const [briefs, setBriefs] = useState<ContentBrief[]>([]);
  const [filter, setFilter] = useState<ContentType | "전체">("전체");
  const { copiedId, copy }  = useCopy();

  useEffect(() => {
    const sync = () => {
      syncBriefsFromServer().then((serverData) => {
        if (serverData) setBriefs(serverData);
        else setBriefs(loadBriefs());
      });
    };
    sync();
    const id = setInterval(sync, 30_000);
    return () => clearInterval(id);
  }, [refreshSignal]);

  const { typeCounts, channelCounts, suggestion } = analyzeHistory(briefs);
  const maxCount = Math.max(...Object.values(typeCounts), 1);

  const filtered = filter === "전체" ? briefs : briefs.filter((b) => b.contentType === filter);

  return (
    <div className="space-y-5">
      {/* 통계 */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-5">
        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100 mb-4">콘텐츠 유형 분포</p>
        <div className="space-y-2.5">
          {(Object.entries(typeCounts) as [ContentType, number][]).map(([type, count]) => (
            <div key={type} className="flex items-center gap-3">
              <span className="text-xs text-zinc-500 w-16 shrink-0">{type}</span>
              <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 rounded-full h-2">
                <div className="h-2 rounded-full bg-zinc-700 dark:bg-zinc-300 transition-all"
                  style={{ width: `${(count / maxCount) * 100}%` }} />
              </div>
              <span className="text-xs font-semibold text-zinc-500 w-4 text-right">{count}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-start gap-2">
          <Lightbulb size={14} className="shrink-0 mt-0.5 text-amber-500" />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{suggestion}</p>
        </div>
      </div>

      {/* 채널 사용 분포 */}
      <div className="grid grid-cols-4 gap-3">
        {(Object.entries(channelCounts) as [Channel, number][]).map(([ch, cnt]) => (
          <div key={ch} className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 text-center">
            <p className="text-lg">{CHANNEL_ICONS[ch]}</p>
            <p className="text-xs font-medium text-zinc-500 mt-1">{CHANNEL_LABEL[ch].replace("인스타 ", "")}</p>
            <p className="text-xl font-bold text-zinc-800 dark:text-zinc-100">{cnt}</p>
          </div>
        ))}
      </div>

      {/* 필터 + 목록 */}
      <div>
        <div className="flex gap-1.5 flex-wrap mb-4">
          {(["전체", ...CONTENT_TYPES] as (ContentType | "전체")[]).map((t) => (
            <button key={t} onClick={() => setFilter(t)}
              className={`text-xs px-3 py-1.5 rounded-xl font-medium transition-all ${
                filter === t ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900" : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-500"
              }`}>{t}</button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-zinc-400">
            <History size={36} className="mx-auto mb-2 opacity-20" />
            <p className="text-sm">저장된 기획서가 없습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((b) => (
              <div key={b.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CONTENT_TYPE_COLORS[b.contentType]}`}>{b.contentType}</span>
                      {b.channels.map((c) => (
                        <span key={c} className="text-[10px] text-zinc-400">{CHANNEL_ICONS[c]} {CHANNEL_LABEL[c]}</span>
                      ))}
                    </div>
                    <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mt-1.5">{b.title}</p>
                    <p className="text-xs text-zinc-400">{b.product} · {b.season}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => copy(b.hooks[b.selectedHook]?.text ?? "", b.id)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      {copiedId === b.id ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                    <button onClick={() => { deleteBrief(b.id); setBriefs(loadBriefs()); }}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 italic">"{b.hooks[b.selectedHook]?.text}"</p>
                <p className="text-[11px] text-zinc-300 dark:text-zinc-600 mt-2">{new Date(b.createdAt).toLocaleDateString("ko-KR")}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 공통 소형 컴포넌트 ─────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-zinc-500 mb-2 block">{label}</label>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium transition-all ${
        active
          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-transparent"
          : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-400"
      }`}>
      {children}
    </button>
  );
}

function Tag({ color, children }: { color: "blue" | "amber" | "zinc"; children: React.ReactNode }) {
  const cls = {
    blue:  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    zinc:  "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  }[color];
  return <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cls}`}>{children}</span>;
}

// ────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────────────────────────

export default function ContentStudio() {
  const [tab, setTab]               = useState<Tab>("generate");
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "generate", label: "기획서 생성",  icon: Clapperboard  },
    { id: "convert",  label: "채널 변환",    icon: Repeat2        },
    { id: "trends",   label: "트렌드 스캔",  icon: TrendingUp     },
    { id: "history",  label: "히스토리",     icon: History        },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-orange-500 rounded-xl flex items-center justify-center">
            <Film size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">콘텐츠 기획 스튜디오</h1>
            <p className="text-xs text-zinc-400 mt-0.5">촬영 대본 · 씬 구성 · 채널별 최적화 · 트렌드 분석</p>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex gap-1.5 bg-zinc-100 dark:bg-zinc-800 p-1.5 rounded-2xl overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
                tab === id
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        {tab === "generate" && <GenerateTab onSaved={() => setHistoryRefresh((n) => n + 1)} />}
        {tab === "convert"  && <ConvertTab />}
        {tab === "trends"   && <TrendsTab />}
        {tab === "history"  && <HistoryTab refreshSignal={historyRefresh} />}

      </div>
    </div>
  );
}
