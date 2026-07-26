/**
 * 채널별 Excel 업로드 데이터 영속 저장 (Supabase kv_store).
 * 데스크톱에서 업로드한 데이터를 모바일에서도 동일하게 볼 수 있게 함.
 *
 * 저장 형식:
 *   { uploads: PerUpload[] }   — 채널별로 업로드된 파일들의 배열
 *
 * 동일 fileName 재업로드는 교체, 다른 파일명은 누적.
 * GET/PUT 응답으로 반환되는 data/meta 는 모든 누적 업로드를 머지한 결과.
 *
 * GET    /api/profit/channel-uploads
 *   → { ok, uploads: { [channel]: { data, meta, history } } }
 * PUT    /api/profit/channel-uploads
 *   body: { channel, data, meta }                 → 새 업로드 누적 (머지된 결과 응답)
 *         { channel, clear: true }                → 채널 전체 삭제
 *         { channel, removeUploadedAt: string }   → 특정 업로드 1건만 삭제
 */
import { createClient } from "@supabase/supabase-js";
import {
  mergeUploads,
  type MultiChannelData,
  type UploadableChannel,
  type PerUpload,
  type MergedChannelUpload,
} from "@/lib/multiChannelData";

export const dynamic = "force-dynamic";

interface UploadMeta {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
}

interface StoredRecord {
  uploads: PerUpload[];
}

const KEY_PREFIX = "channel_upload:";

const ALLOWED: UploadableChannel[] = [
  "wconcept",
  "musinsa",
  "29cm",
  "groupbuy",
  "kakao_gift",
  "lotte_dutyfree",
  "shinsegae_dutyfree",
  "naver_smartstore",
];

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * kv_store 에 저장된 raw 값을 항상 { uploads: PerUpload[] } 형태로 정규화.
 * 구버전 포맷({ data, meta }) 도 지원 — 단일 업로드로 변환.
 */
function normalizeStored(raw: unknown): StoredRecord {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.uploads)) {
      return { uploads: r.uploads as PerUpload[] };
    }
    // 구버전: { data: MultiChannelData, meta: UploadMeta }
    if (r.data && r.meta) {
      const meta = r.meta as UploadMeta;
      const data = r.data as MultiChannelData;
      return {
        uploads: [
          {
            fileName: meta.fileName,
            rowCount: meta.rowCount,
            period: meta.period,
            uploadedAt: meta.uploadedAt,
            data,
          },
        ],
      };
    }
  }
  return { uploads: [] };
}

/**
 * 새 업로드를 기존 record 에 합친다.
 * 정책: 동일 fileName 이 있으면 교체 (재업로드/보정), 없으면 추가.
 */
function upsertPerUpload(record: StoredRecord, upload: PerUpload): StoredRecord {
  const others = record.uploads.filter((u) => u.fileName !== upload.fileName);
  others.push(upload);
  others.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  return { uploads: others };
}

function recordToResponse(record: StoredRecord): MergedChannelUpload | null {
  return mergeUploads(record.uploads);
}

export async function GET() {
  const db = getDb();
  if (!db) {
    return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });
  }

  const keys = ALLOWED.map((c) => `${KEY_PREFIX}${c}`);
  const { data, error } = await db
    .from("kv_store")
    .select("key, data")
    .in("key", keys);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const uploads: Partial<Record<UploadableChannel, MergedChannelUpload>> = {};
  for (const row of data ?? []) {
    const channel = (row.key as string).slice(KEY_PREFIX.length) as UploadableChannel;
    if (!ALLOWED.includes(channel)) continue;
    const record = normalizeStored(row.data);
    const merged = recordToResponse(record);
    if (merged) uploads[channel] = merged;
  }

  return Response.json({ ok: true, uploads });
}

// supabase-js 의 generic 타입이 strict 해서 ReturnType<typeof createClient> 로 받으면
// `.from("kv_store")` 결과가 never 로 추론된다. 헬퍼는 any 로 받고 내부에서 좁힌다.
type SupabaseLike = ReturnType<typeof getDb>;

async function readRecord(db: SupabaseLike, key: string): Promise<StoredRecord> {
  if (!db) return { uploads: [] };
  const { data, error } = await db
    .from("kv_store")
    .select("data")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (data as { data?: unknown } | null)?.data;
  return normalizeStored(raw);
}

async function writeRecord(db: SupabaseLike, key: string, record: StoredRecord) {
  if (!db) throw new Error("Supabase 미설정");
  const { error } = await db.from("kv_store").upsert(
    { key, data: record, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
}

export async function PUT(req: Request) {
  const db = getDb();
  if (!db) {
    return Response.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });
  }

  let body: {
    channel?: string;
    data?: MultiChannelData;
    meta?: UploadMeta;
    clear?: boolean;
    removeUploadedAt?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 요청 본문" }, { status: 400 });
  }

  const channel = body.channel as UploadableChannel | undefined;
  if (!channel || !ALLOWED.includes(channel)) {
    return Response.json(
      { ok: false, error: "허용되지 않은 channel" },
      { status: 400 }
    );
  }

  const key = `${KEY_PREFIX}${channel}`;

  // 1) 채널 전체 삭제
  if (body.clear) {
    const { error } = await db.from("kv_store").delete().eq("key", key);
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
    return Response.json({ ok: true, channel, cleared: true, upload: null });
  }

  // 2) 특정 업로드 한 건만 삭제
  if (body.removeUploadedAt) {
    try {
      const existing = await readRecord(db, key);
      const next: StoredRecord = {
        uploads: existing.uploads.filter((u) => u.uploadedAt !== body.removeUploadedAt),
      };
      if (next.uploads.length === 0) {
        const { error } = await db.from("kv_store").delete().eq("key", key);
        if (error) throw new Error(error.message);
        return Response.json({ ok: true, channel, removed: body.removeUploadedAt, upload: null });
      }
      await writeRecord(db, key, next);
      return Response.json({
        ok: true,
        channel,
        removed: body.removeUploadedAt,
        upload: recordToResponse(next),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Response.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // 3) 새 업로드 누적
  if (!body.data || !body.meta) {
    return Response.json(
      { ok: false, error: "data, meta 필수" },
      { status: 400 }
    );
  }

  try {
    const existing = await readRecord(db, key);
    const newUpload: PerUpload = {
      fileName: body.meta.fileName,
      rowCount: body.meta.rowCount,
      period: body.meta.period,
      uploadedAt: body.meta.uploadedAt,
      data: body.data,
    };
    const next = upsertPerUpload(existing, newUpload);
    await writeRecord(db, key, next);
    return Response.json({
      ok: true,
      channel,
      upload: recordToResponse(next),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
