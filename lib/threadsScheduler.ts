/**
 * Threads 자동 게시 & 모니터링 관련 Supabase 스토리지
 */
import { createClient } from "@supabase/supabase-js";
import type { BrandId } from "./threadsBrands";

const KV_QUEUE_KEY = "threads_post_queue";       // 자동 게시 대기 큐
const KV_PUBLISHED_KEY = "threads_published_log"; // 게시 완료 로그 (모니터링용)
const KV_NOTIFIED_KEY = "threads_notified_ids";   // 이미 알림 보낸 ID
const KV_AUTOPOST_SETTINGS_KEY = "threads_autopost_settings"; // 브랜드별 하루 게시 횟수

export interface QueuedPost {
  id: string;
  text: string;
  brand: BrandId;
  mediaUrl?: string;
  mediaType?: "IMAGE" | "VIDEO";
  scheduledAt?: string;
}

export interface PublishedPost {
  threadId: string;
  text: string;
  publishedAt: string;  // ISO
  postId: string;       // 원본 저장 글 ID
  brand: BrandId;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function kvGet<T>(key: string): Promise<T | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", key)
    .maybeSingle();
  return (data?.data as T) ?? null;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase
    .from("kv_store")
    .upsert(
      { key, data: value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
}

// ── 자동 게시 큐 ──────────────────────────────────────────────────────────

export async function getPostQueue(): Promise<QueuedPost[]> {
  return (await kvGet<QueuedPost[]>(KV_QUEUE_KEY)) ?? [];
}

export async function savePostQueue(queue: QueuedPost[]): Promise<void> {
  await kvSet(KV_QUEUE_KEY, queue);
}

export async function dequeuePost(): Promise<QueuedPost | null> {
  const queue = await getPostQueue();
  if (queue.length === 0) return null;

  // brand 없는 기존 글은 paulvice로 할당
  for (const p of queue) {
    if (!p.brand) p.brand = "paulvice";
  }

  // 브랜드별 그룹화 → 가장 많은 브랜드에서 꺼냄 (라운드로빈 효과)
  const byBrand: Record<string, number[]> = {};
  queue.forEach((p, i) => {
    const b = p.brand;
    if (!byBrand[b]) byBrand[b] = [];
    byBrand[b].push(i);
  });

  // 마지막 게시 브랜드를 추적하여 다른 브랜드 우선
  const lastBrandKey = "threads_last_autopost_brand";
  const lastBrand = (await kvGet<string>(lastBrandKey)) ?? "";
  const brands = Object.keys(byBrand);

  // 마지막에 게시한 브랜드가 아닌 브랜드 우선 선택
  const nextBrand = brands.find((b) => b !== lastBrand) ?? brands[0];
  const candidates = byBrand[nextBrand];
  const pickIdx = candidates[Math.floor(Math.random() * candidates.length)];

  const [post] = queue.splice(pickIdx, 1);
  await savePostQueue(queue);
  await kvSet(lastBrandKey, nextBrand);
  return post;
}

export async function dequeuePostByBrand(brand: BrandId): Promise<QueuedPost | null> {
  const queue = await getPostQueue();
  // brand 없는 기존 글은 paulvice로 할당
  for (const p of queue) {
    if (!p.brand) p.brand = "paulvice";
  }
  const candidates = queue.filter((p) => p.brand === brand);
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const idx = queue.indexOf(pick);
  queue.splice(idx, 1);
  await savePostQueue(queue);
  return pick;
}

// ── 게시 로그 ──────────────────────────────────────────────────────────────

export async function getPublishedLog(): Promise<PublishedPost[]> {
  return (await kvGet<PublishedPost[]>(KV_PUBLISHED_KEY)) ?? [];
}

export async function addPublishedPost(post: PublishedPost): Promise<void> {
  const log = await getPublishedLog();
  log.push(post);
  await kvSet(KV_PUBLISHED_KEY, log);
}

// 15일 이내 게시물만 반환
export async function getRecentPublished(): Promise<PublishedPost[]> {
  const log = await getPublishedLog();
  const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000;
  return log.filter((p) => new Date(p.publishedAt).getTime() > cutoff);
}

// ── 알림 기록 ──────────────────────────────────────────────────────────────

export async function getNotifiedIds(): Promise<Set<string>> {
  const arr = (await kvGet<string[]>(KV_NOTIFIED_KEY)) ?? [];
  return new Set(arr);
}

export async function markNotified(threadId: string): Promise<void> {
  const set = await getNotifiedIds();
  set.add(threadId);
  await kvSet(KV_NOTIFIED_KEY, [...set]);
}

// ── 자동 게시 설정 (하루 게시 횟수) ──────────────────────────────────────

export interface AutopostSettings {
  [brand: string]: { postsPerDay: number };
}

const DEFAULT_AUTOPOST_SETTINGS: AutopostSettings = {
  paulvice: { postsPerDay: 8 },
  harriot: { postsPerDay: 8 },
  hongsungjo: { postsPerDay: 2 },
};

export async function getAutopostSettings(): Promise<AutopostSettings> {
  const saved = await kvGet<AutopostSettings>(KV_AUTOPOST_SETTINGS_KEY);
  return { ...DEFAULT_AUTOPOST_SETTINGS, ...saved };
}

export async function saveAutopostSettings(settings: AutopostSettings): Promise<void> {
  await kvSet(KV_AUTOPOST_SETTINGS_KEY, settings);
}

export function getPostsPerDay(settings: AutopostSettings, brand: BrandId): number {
  return settings[brand]?.postsPerDay ?? DEFAULT_AUTOPOST_SETTINGS[brand]?.postsPerDay ?? 2;
}

/**
 * 오늘 해당 브랜드의 게시 횟수를 세서 아직 게시해야 하는지 판단
 */
export async function shouldPostNow(brand: BrandId, currentHourUTC: number): Promise<boolean> {
  const settings = await getAutopostSettings();
  const target = getPostsPerDay(settings, brand);
  if (target <= 0) return false;

  // 오늘 이 브랜드의 게시 횟수 확인
  const log = await getPublishedLog();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayPosts = log.filter(
    (p) => p.brand === brand && new Date(p.publishedAt).getTime() >= todayStart.getTime()
  );
  if (todayPosts.length >= target) return false;

  // 게시 시간대 계산: 0~23시를 target개로 균등 분배
  const interval = 24 / target;
  const postingHours = Array.from({ length: target }, (_, i) => Math.floor(interval * i + interval / 2));
  return postingHours.includes(currentHourUTC);
}
