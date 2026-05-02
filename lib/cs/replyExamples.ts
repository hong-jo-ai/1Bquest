import { getCsSupabase } from "./store";
import type { CsBrandId, CsChannel } from "./types";

const KEY = "cs_reply_examples";
const MAX_PER_BUCKET = 30;

export interface ReplyExample {
  brand:    CsBrandId;
  channel:  CsChannel;
  customer: string;
  reply:    string;
  ts:       string;
}

async function loadAll(): Promise<ReplyExample[]> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", KEY)
    .maybeSingle();
  if (!data?.data || !Array.isArray(data.data)) return [];
  return data.data as ReplyExample[];
}

async function saveAll(rows: ReplyExample[]): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").upsert(
    { key: KEY, data: rows, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

export async function addReplyExample(ex: {
  brand:    CsBrandId;
  channel:  CsChannel;
  customer: string;
  reply:    string;
}): Promise<void> {
  const customer = ex.customer.trim();
  const reply = ex.reply.trim();
  if (!customer || !reply) return;

  const all = await loadAll();
  const sameBucket = all.filter(
    (e) => e.brand === ex.brand && e.channel === ex.channel
  );
  const otherBuckets = all.filter(
    (e) => !(e.brand === ex.brand && e.channel === ex.channel)
  );

  const next: ReplyExample = {
    brand:    ex.brand,
    channel:  ex.channel,
    customer: customer.slice(0, 1500),
    reply:    reply.slice(0, 2000),
    ts:       new Date().toISOString(),
  };

  // 신규 항목을 맨 앞, 같은 버킷 내에서 MAX 유지
  const updated = [next, ...sameBucket].slice(0, MAX_PER_BUCKET);
  await saveAll([...updated, ...otherBuckets]);
}

export async function getReplyExamples(
  brand:   CsBrandId,
  channel: CsChannel,
  limit = 6
): Promise<ReplyExample[]> {
  const all = await loadAll();
  return all
    .filter((e) => e.brand === brand && e.channel === channel)
    .slice(0, limit);
}
