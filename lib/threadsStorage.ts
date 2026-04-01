import { saveWithSync, loadFromServer } from "./syncStorage";

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
  text:       string;          // 원문 또는 요약
  url?:       string;          // 쓰레드 URL
  author?:    string;          // 작성자
  likes?:     number;
  reposts?:   number;
  category:   ThreadsCategory;
  analysis: {
    hook:            string;   // 첫 문장 후킹 방식
    format:          string;   // 형식 (질문형, 리스트형 등)
    tone:            string;   // 톤
    drivers:         string[]; // 반응 유발 요소
    lesson:          string;   // 폴바이스에게 배울 점
  };
  savedAt:    string;
}

export interface GeneratedPost {
  id:          string;
  text:        string;
  style:       PostStyle;
  topic:       string;
  hook:        string;         // 이 글의 후킹 포인트 설명
  whyItWorks:  string;        // 왜 반응이 좋을지 설명
  savedAt:     string;
  liked:       boolean;
}

export interface TrendAnalysis {
  keywords:     string[];
  generatedAt:  string;
  formats:      { name: string; description: string; example: string }[];
  hooks:        { hook: string; example: string }[];
  themes:       { theme: string; reason: string; paulviceAngle: string }[];
  insights:     string[];
}

// ── 스토리지 키 ────────────────────────────────────────────────────────────

const REFS_KEY   = "paulvice_threads_refs_v1";
const POSTS_KEY  = "paulvice_threads_posts_v1";
const TREND_KEY  = "paulvice_threads_trend_v1";

// ── 레퍼런스 CRUD ─────────────────────────────────────────────────────────

export function loadRefs(): ThreadsRef[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(REFS_KEY) ?? "[]"); } catch { return []; }
}
export function saveRefs(list: ThreadsRef[]) {
  saveWithSync(REFS_KEY, list);
}
export async function syncRefsFromServer(): Promise<ThreadsRef[] | null> {
  return loadFromServer<ThreadsRef[]>(REFS_KEY);
}
export function addRef(ref: Omit<ThreadsRef, "id" | "savedAt">): ThreadsRef {
  const list = loadRefs();
  const newRef: ThreadsRef = { ...ref, id: crypto.randomUUID(), savedAt: new Date().toISOString() };
  saveRefs([newRef, ...list]);
  return newRef;
}
export function deleteRef(id: string) {
  saveRefs(loadRefs().filter((r) => r.id !== id));
}

// ── 생성 글 CRUD ──────────────────────────────────────────────────────────

export function loadPosts(): GeneratedPost[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(POSTS_KEY) ?? "[]"); } catch { return []; }
}
export function savePosts(list: GeneratedPost[]) {
  saveWithSync(POSTS_KEY, list);
}
export async function syncPostsFromServer(): Promise<GeneratedPost[] | null> {
  return loadFromServer<GeneratedPost[]>(POSTS_KEY);
}
export function addPosts(posts: Omit<GeneratedPost, "id" | "savedAt" | "liked">[]): GeneratedPost[] {
  const list = loadPosts();
  const newPosts: GeneratedPost[] = posts.map((p) => ({
    ...p, id: crypto.randomUUID(), savedAt: new Date().toISOString(), liked: false,
  }));
  savePosts([...newPosts, ...list]);
  return newPosts;
}
export function toggleLike(id: string) {
  savePosts(loadPosts().map((p) => p.id === id ? { ...p, liked: !p.liked } : p));
}
export function deletePost(id: string) {
  savePosts(loadPosts().filter((p) => p.id !== id));
}

// ── 트렌드 분석 캐시 ──────────────────────────────────────────────────────

export function loadTrend(): TrendAnalysis | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(TREND_KEY) ?? "null"); } catch { return null; }
}
export function saveTrend(trend: TrendAnalysis) {
  localStorage.setItem(TREND_KEY, JSON.stringify(trend));
}
