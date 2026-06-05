/**
 * 채널 업로드 영속 저장 — 무인(에이전트/크론) 적재용 공용 헬퍼.
 *
 * app/api/profit/channel-uploads/route.ts 의 "새 업로드 누적" 로직과 동일한 형식
 * (kv_store 키 `channel_upload:{channel}`, { uploads: PerUpload[] }, 동일 fileName 교체)
 * 을 따른다. 인터랙티브 업로드와 동일 저장소를 공유하므로 대시보드에서 그대로 보인다.
 */
import { createClient } from "@supabase/supabase-js";
import {
  mergeUploads,
  type MultiChannelData,
  type UploadableChannel,
  type PerUpload,
  type MergedChannelUpload,
} from "@/lib/multiChannelData";

const KEY_PREFIX = "channel_upload:";

export interface UploadMeta {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
}

interface StoredRecord {
  uploads: PerUpload[];
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** kv 의 raw 값을 { uploads: PerUpload[] } 로 정규화 (구버전 { data, meta } 도 지원). */
function normalizeStored(raw: unknown): StoredRecord {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.uploads)) return { uploads: r.uploads as PerUpload[] };
    if (r.data && r.meta) {
      const m = r.meta as UploadMeta;
      return {
        uploads: [
          { fileName: m.fileName, rowCount: m.rowCount, period: m.period, uploadedAt: m.uploadedAt, data: r.data as MultiChannelData },
        ],
      };
    }
  }
  return { uploads: [] };
}

/**
 * 새 업로드 1건을 채널 누적 저장소에 반영하고, 머지된 결과를 반환.
 * 동일 fileName 은 교체(재적재), 다른 파일명은 누적.
 */
export async function storeChannelUpload(
  channel: UploadableChannel,
  data: MultiChannelData,
  meta: UploadMeta
): Promise<MergedChannelUpload | null> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const key = `${KEY_PREFIX}${channel}`;

  const { data: row, error: readErr } = await db
    .from("kv_store")
    .select("data")
    .eq("key", key)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);

  const existing = normalizeStored((row as { data?: unknown } | null)?.data);
  const newUpload: PerUpload = {
    fileName: meta.fileName,
    rowCount: meta.rowCount,
    period: meta.period,
    uploadedAt: meta.uploadedAt,
    data,
  };
  const others = existing.uploads.filter((u) => u.fileName !== newUpload.fileName);
  others.push(newUpload);
  others.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const next: StoredRecord = { uploads: others };

  const { error: writeErr } = await db
    .from("kv_store")
    .upsert({ key, data: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (writeErr) throw new Error(writeErr.message);

  return mergeUploads(next.uploads);
}
