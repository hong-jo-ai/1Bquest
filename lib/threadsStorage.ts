import { saveWithSync, loadFromServer } from "./syncStorage";
import type { BrandId } from "./threadsBrands";

// ── 타입 ──────────────────────────────────────────────────────────────────

export type ThreadsCategory =
  | "패션" | "시계" | "주얼리" | "패션잡화" | "브랜드" | "라이프스타일" | "기타";

export type PostStyle =
  | "공감형"    // "이 느낌 알아요?"
  | "정보형"    // "이거 몰랐죠?"
  | "질문형"    // 답글 유도
  | "스토리형"  // 짧은 이야기
  | "선언형"    // 강한 주장/의견
  | "감성형";   // 분위기·무드

export interface ThreadsRef {
  id:         string;
  text:       string;
  url?:       string;
  author?:    string;
  likes?:     number;
  reposts?:   number;
  category:   ThreadsCategory;
  analysis: {
    hook:            string;
    format:          string;
    tone:            string;
    drivers:         string[];
    lesson:          string;
  };
  savedAt:    string;
}

export interface GeneratedPost {
  id:          string;
  text:        string;
  style:       PostStyle;
  topic:       string;
  hook:        string;
  whyItWorks:  string;
  savedAt:     string;
  liked:       boolean;
}

export interface TrendAnalysis {
  keywords:     string[];
  generatedAt:  string;
  formats:      { name: string; description: string; example: string }[];
  hooks:        { hook: string; example: string }[];
  themes:       { theme: string; reason: string; brandAngle?: string; paulviceAngle?: string }[];
  insights:     string[];
}

// ── 브랜드별 스토리지 키 ──────────────────────────────────────────────────

function refsKey(brand: BrandId)  { return `threads_refs_${brand}_v1`; }
function postsKey(brand: BrandId) { return `threads_posts_${brand}_v1`; }
function trendKey(brand: BrandId) { return `threads_trend_${brand}_v1`; }

// ── 레퍼런스 CRUD ─────────────────────────────────────────────────────────

export function loadRefs(brand: BrandId = "paulvice"): ThreadsRef[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(refsKey(brand)) ?? "[]"); } catch { return []; }
}
export function saveRefs(list: ThreadsRef[], brand: BrandId = "paulvice") {
  saveWithSync(refsKey(brand), list);
}
export async function syncRefsFromServer(brand: BrandId = "paulvice"): Promise<ThreadsRef[] | null> {
  return loadFromServer<ThreadsRef[]>(refsKey(brand));
}
export function addRef(ref: Omit<ThreadsRef, "id" | "savedAt">, brand: BrandId = "paulvice"): ThreadsRef {
  const list = loadRefs(brand);
  const newRef: ThreadsRef = { ...ref, id: crypto.randomUUID(), savedAt: new Date().toISOString() };
  saveRefs([newRef, ...list], brand);
  return newRef;
}
export function deleteRef(id: string, brand: BrandId = "paulvice") {
  saveRefs(loadRefs(brand).filter((r) => r.id !== id), brand);
}

// ── 생성 글 CRUD ──────────────────────────────────────────────────────────

export function loadPosts(brand: BrandId = "paulvice"): GeneratedPost[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(postsKey(brand)) ?? "[]"); } catch { return []; }
}
export function savePosts(list: GeneratedPost[], brand: BrandId = "paulvice") {
  saveWithSync(postsKey(brand), list);
}
export async function syncPostsFromServer(brand: BrandId = "paulvice"): Promise<GeneratedPost[] | null> {
  return loadFromServer<GeneratedPost[]>(postsKey(brand));
}
export function addPosts(posts: Omit<GeneratedPost, "id" | "savedAt" | "liked">[], brand: BrandId = "paulvice"): GeneratedPost[] {
  const list = loadPosts(brand);
  const newPosts: GeneratedPost[] = posts.map((p) => ({
    ...p, id: crypto.randomUUID(), savedAt: new Date().toISOString(), liked: false,
  }));
  savePosts([...newPosts, ...list], brand);
  return newPosts;
}
export function toggleLike(id: string, brand: BrandId = "paulvice") {
  savePosts(loadPosts(brand).map((p) => p.id === id ? { ...p, liked: !p.liked } : p), brand);
}
export function deletePost(id: string, brand: BrandId = "paulvice") {
  savePosts(loadPosts(brand).filter((p) => p.id !== id), brand);
}

// ── 트렌드 분석 캐시 ──────────────────────────────────────────────────────

export function loadTrend(brand: BrandId = "paulvice"): TrendAnalysis | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(trendKey(brand)) ?? "null"); } catch { return null; }
}
export function saveTrend(trend: TrendAnalysis, brand: BrandId = "paulvice") {
  localStorage.setItem(trendKey(brand), JSON.stringify(trend));
}
