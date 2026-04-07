/**
 * Threads 자동 게시 & 모니터링 관련 Supabase 스토리지
 */
import { createClient } from "@supabase/supabase-js";
import type { BrandId } from "./threadsBrands";

const KV_QUEUE_KEY = "threads_post_queue";       // 자동 게시 대기 큐
const KV_PUBLISHED_KEY = "threads_published_log"; // 게시 완료 로그 (모니터링용)
const KV_NOTIFIED_KEY = "threads_notified_ids";   // 이미 알림 보낸 ID

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
  const idx = Math.floor(Math.random() * queue.length);
  const [post] = queue.splice(idx, 1);
  await savePostQueue(queue);
  return post;
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
