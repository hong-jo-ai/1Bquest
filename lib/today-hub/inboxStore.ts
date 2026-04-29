/**
 * 오늘의 운영 허브 — 답장 필요 인박스: AI 분류 결과 + 사용자 피드백 영속 저장.
 *
 * 키:
 *   today_hub_inbox:msg:{messageId}   → ClassifiedEmail (분류 결과 캐시 — 한 번 분류된 메일은 재분류 안 함)
 *   today_hub_inbox:negatives          → NegativeExample[] (사용자가 "필요없음"으로 거른 사례 누적)
 *   today_hub_inbox:status             → { lastSyncAt, classifiedCount, errorCount, ... }
 */
import { createClient } from "@supabase/supabase-js";

export interface ClassifiedEmail {
  messageId:    string;
  threadId:     string;

  fromEmail:    string;
  fromName:     string | null;
  subject:      string;
  snippet:      string;
  receivedAt:   string; // ISO

  needsReply:   boolean;
  reason:       string;       // Claude 가 판단한 이유 (한 줄)
  confidence:   number;       // 0~1
  classifiedAt: string;       // ISO

  /** 사용자가 '필요없음' 으로 직접 거른 메일 — 위젯에서 숨김 */
  userMarkedNotNeeded: boolean;
  /** 같은 스레드에 SENT 메시지가 있으면 자동 true → 위젯에서 숨김 */
  userReplied:         boolean;
  dismissedAt?:        string;
}

export interface NegativeExample {
  fromEmail:     string;
  subjectSample: string;
  reason:        string;       // 사용자가 적었거나 자동 ("발신자 X 차단")
  createdAt:     string;
}

export interface InboxSyncStatus {
  lastSyncAt:       string;
  scannedCount:     number;     // 14일 내 인박스 메일 수
  newClassified:    number;     // 이번 sync 에서 새로 분류된 수
  errorCount:       number;
  classificationErrors?: Array<{ messageId: string; error: string }>;
  /** 첫 번째로 만난 fatal 에러 (잔액/자격증명) — 이후 호출 모두 스킵됨 */
  fatalError?:      string;
}

const MSG_PREFIX  = "today_hub_inbox:msg:";
const NEG_KEY     = "today_hub_inbox:negatives";
const STATUS_KEY  = "today_hub_inbox:status";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function getClassifiedEmail(messageId: string): Promise<ClassifiedEmail | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", `${MSG_PREFIX}${messageId}`)
    .maybeSingle();
  return (data?.data as ClassifiedEmail | null) ?? null;
}

export async function listClassifiedEmails(): Promise<ClassifiedEmail[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from("kv_store")
    .select("data")
    .like("key", `${MSG_PREFIX}%`);
  return (data ?? []).map((r) => r.data as ClassifiedEmail);
}

export async function saveClassifiedEmail(email: ClassifiedEmail): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  await db.from("kv_store").upsert(
    {
      key: `${MSG_PREFIX}${email.messageId}`,
      data: email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

export async function patchClassifiedEmail(
  messageId: string,
  patch: Partial<ClassifiedEmail>,
): Promise<ClassifiedEmail | null> {
  const existing = await getClassifiedEmail(messageId);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  await saveClassifiedEmail(updated);
  return updated;
}

/** 14일 보다 오래된 분류 결과 정리 (옵션 — 사용자 피드백 보존 위해 NegativeExample 만 유지) */
export async function pruneOldEmails(daysAgo: number): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const all = await listClassifiedEmails();
  const toDelete = all.filter((e) => e.receivedAt < cutoff);
  for (const e of toDelete) {
    await db.from("kv_store").delete().eq("key", `${MSG_PREFIX}${e.messageId}`);
  }
  return toDelete.length;
}

// ── 부정 사례 ───────────────────────────────────────────────────────────────

export async function listNegativeExamples(): Promise<NegativeExample[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", NEG_KEY)
    .maybeSingle();
  return (data?.data as NegativeExample[] | null) ?? [];
}

export async function addNegativeExample(ex: NegativeExample): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const list = await listNegativeExamples();
  // 같은 발신자+제목 중복 제거
  const filtered = list.filter(
    (e) => !(e.fromEmail === ex.fromEmail && e.subjectSample === ex.subjectSample),
  );
  filtered.push(ex);
  // 최대 200개로 제한 (오래된 순으로 자름)
  const trimmed = filtered.slice(-200);
  await db.from("kv_store").upsert(
    { key: NEG_KEY, data: trimmed, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

// ── 상태 ────────────────────────────────────────────────────────────────────

export async function getStatus(): Promise<InboxSyncStatus | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", STATUS_KEY)
    .maybeSingle();
  return (data?.data as InboxSyncStatus | null) ?? null;
}

export async function saveStatus(status: InboxSyncStatus): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("kv_store").upsert(
    { key: STATUS_KEY, data: status, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}
