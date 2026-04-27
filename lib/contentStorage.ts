// ── 타입 ──────────────────────────────────────────────────────────────────

export type Channel = "reels" | "youtube_shorts" | "instagram_feed" | "threads";
export type ContentType = "제품소개" | "스타일링" | "스토리텔링" | "비하인드" | "튜토리얼" | "시즌이슈";
export type Emotion = "감성적" | "실용적" | "트렌디" | "따뜻한" | "세련된" | "공감형";

export const CHANNEL_LABEL: Record<Channel, string> = {
  reels:            "인스타 릴스",
  youtube_shorts:   "유튜브 쇼츠",
  instagram_feed:   "인스타 피드",
  threads:          "쓰레드",
};

export const CHANNEL_DURATION: Record<Channel, string> = {
  reels:            "15초",
  youtube_shorts:   "60초",
  instagram_feed:   "정적 이미지",
  threads:          "텍스트",
};

export const CONTENT_TYPE_COLORS: Record<ContentType, string> = {
  제품소개:    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  스타일링:    "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
  스토리텔링:  "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  비하인드:    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  튜토리얼:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  시즌이슈:   "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
};

export interface Scene {
  order:      number;
  angle:      string;      // 앵글
  background: string;      // 배경
  props:      string[];    // 소품
  duration:   string;      // 권장 길이
  note:       string;      // 촬영 노트
}

export interface Script {
  intro: string;   // 도입 (Hook 발화)
  body:  string;   // 본론
  cta:   string;   // CTA
}

export interface ShootingChecklist {
  styling:    string[];  // 착장
  props:      string[];  // 소품
  background: string[];  // 배경
  equipment:  string[];  // 장비/세팅
}

export interface ChannelVersion {
  channel:   Channel;
  script:    string;     // 채널용 대본 또는 캡션
  notes:     string;     // 채널별 촬영/편집 노트
}

export interface ContentBrief {
  id:           string;
  // 입력값
  product:      string;
  season:       string;
  emotion:      Emotion;
  channels:     Channel[];
  contentType:  ContentType;
  // 생성 결과
  hooks:        { text: string; type: string }[];
  selectedHook: number;
  scenes:       Scene[];
  script:       Script;
  caption:      string;
  hashtags:     string[];
  checklist:    ShootingChecklist;
  channelVersions: ChannelVersion[];
  // 메타
  createdAt:    string;
  title:        string;   // 자동 생성 제목
}

import { saveWithSync, loadFromServer } from "./syncStorage";

// ── 트렌드 캐시 ───────────────────────────────────────────────────────────

export interface TrendCache {
  generatedAt: string;
  viralHooks:      any[];
  contentFormats:  any[];
  trendingThemes:  any[];
  searchKeywords:  any[];
  quickTips:       string[];
  sources:         Record<string, { active: boolean; label: string }>;
}

const TREND_KEY = "paulvice_trend_cache_v1";

export function loadTrendCache(): TrendCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TREND_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as TrendCache;
    // 24시간 지난 캐시는 무효
    if (Date.now() - new Date(cache.generatedAt).getTime() > 24 * 60 * 60 * 1000) return null;
    return cache;
  } catch { return null; }
}

export function saveTrendCache(data: TrendCache) {
  if (typeof window === "undefined") return;
  saveWithSync(TREND_KEY, data);
}

export async function syncTrendCacheFromServer(): Promise<TrendCache | null> {
  const cache = await loadFromServer<TrendCache>(TREND_KEY);
  if (!cache) return null;
  // 24시간 지난 서버 캐시도 무효 처리 (loadTrendCache와 동일 정책)
  if (Date.now() - new Date(cache.generatedAt).getTime() > 24 * 60 * 60 * 1000) return null;
  return cache;
}

// ── 스토리지 ──────────────────────────────────────────────────────────────

const KEY = "paulvice_content_briefs_v1";

export function loadBriefs(): ContentBrief[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
export function saveBriefs(list: ContentBrief[]) {
  saveWithSync(KEY, list);
}

export async function syncBriefsFromServer(): Promise<ContentBrief[] | null> {
  return loadFromServer<ContentBrief[]>(KEY);
}
export function addBrief(brief: Omit<ContentBrief, "id" | "createdAt">): ContentBrief {
  const list = loadBriefs();
  const newBrief: ContentBrief = { ...brief, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  saveBriefs([newBrief, ...list]);
  return newBrief;
}
export function deleteBrief(id: string) {
  saveBriefs(loadBriefs().filter((b) => b.id !== id));
}
export function updateBriefHook(id: string, idx: number) {
  saveBriefs(loadBriefs().map((b) => b.id === id ? { ...b, selectedHook: idx } : b));
}

// ── 히스토리 분석 ──────────────────────────────────────────────────────────

export function analyzeHistory(briefs: ContentBrief[]): {
  typeCounts: Record<ContentType, number>;
  channelCounts: Record<Channel, number>;
  suggestion: string;
} {
  const typeCounts = {
    제품소개: 0, 스타일링: 0, 스토리텔링: 0, 비하인드: 0, 튜토리얼: 0, 시즌이슈: 0,
  } as Record<ContentType, number>;
  const channelCounts = {
    reels: 0, youtube_shorts: 0, instagram_feed: 0, threads: 0,
  } as Record<Channel, number>;

  briefs.forEach((b) => {
    typeCounts[b.contentType] = (typeCounts[b.contentType] ?? 0) + 1;
    b.channels.forEach((c) => { channelCounts[c] = (channelCounts[c] ?? 0) + 1; });
  });

  // 가장 적게 사용된 타입 추천
  const allTypes: ContentType[] = ["제품소개", "스타일링", "스토리텔링", "비하인드", "튜토리얼", "시즌이슈"];
  const leastUsed = allTypes.sort((a, b) => (typeCounts[a] ?? 0) - (typeCounts[b] ?? 0));
  const mostUsed  = allTypes[allTypes.length - 1];

  const suggestionMap: Record<ContentType, string> = {
    제품소개:   "제품 소개가 많았습니다. 이번엔 실제 착용 스토리나 비하인드로 브랜드 감성을 더해보세요.",
    스타일링:   "스타일링 콘텐츠 위주였습니다. 시계를 선물하는 스토리나 각인의 의미를 담은 스토리텔링을 시도해보세요.",
    스토리텔링: "스토리 중심이었습니다. 실용적인 착용 팁이나 제품 디테일 클로즈업도 밸런스 있게 넣어보세요.",
    비하인드:   "비하인드가 많았습니다. 완성된 룩북 스타일의 스타일링 콘텐츠로 전환해보세요.",
    튜토리얼:  "튜토리얼이 많았습니다. 감성적인 무드 영상이나 시즌 이슈 연계 콘텐츠를 시도해보세요.",
    시즌이슈:  "시즌 이슈 연계가 많았습니다. 브랜드 고유의 스타일링 콘텐츠로 일상성을 강화해보세요.",
  };

  return {
    typeCounts,
    channelCounts,
    suggestion: briefs.length === 0
      ? "아직 기획서가 없습니다. 첫 번째 콘텐츠를 기획해보세요!"
      : suggestionMap[mostUsed] ?? "다양한 유형의 콘텐츠를 시도해보세요.",
  };
}
