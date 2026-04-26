/**
 * 채널별 Excel 업로드 데이터 영속 저장 (Supabase kv_store).
 * 데스크톱에서 업로드한 데이터를 모바일에서도 동일하게 볼 수 있게 함.
 *
 * GET  /api/profit/channel-uploads             → 모든 채널 업로드 일괄 반환
 * PUT  /api/profit/channel-uploads             → { channel, data, meta } 저장 또는 { channel, clear: true } 삭제
 */
import { createClient } from "@supabase/supabase-js";
import type { MultiChannelData, UploadableChannel } from "@/lib/multiChannelData";

export const dynamic = "force-dynamic";

interface UploadMeta {
  fileName: string;
  rowCount: number;
  period: { start: string; end: string };
  uploadedAt: string;
}

interface ChannelUpload {
  data: MultiChannelData;
  meta: UploadMeta;
}

const KEY_PREFIX = "channel_upload:";

const ALLOWED: UploadableChannel[] = [
  "wconcept",
  "musinsa",
  "29cm",
  "groupbuy",
  "sixshop",
  "naver_smartstore",
  "sixshop_global",
];

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
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

  const uploads: Partial<Record<UploadableChannel, ChannelUpload>> = {};
  for (const row of data ?? []) {
    const channel = (row.key as string).slice(KEY_PREFIX.length) as UploadableChannel;
    if (ALLOWED.includes(channel)) {
      uploads[channel] = row.data as ChannelUpload;
    }
  }

  return Response.json({ ok: true, uploads });
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

  if (body.clear) {
    const { error } = await db.from("kv_store").delete().eq("key", key);
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500 });
    }
    return Response.json({ ok: true, channel, cleared: true });
  }

  if (!body.data || !body.meta) {
    return Response.json(
      { ok: false, error: "data, meta 필수" },
      { status: 400 }
    );
  }

  const upload: ChannelUpload = { data: body.data, meta: body.meta };
  const { error } = await db
    .from("kv_store")
    .upsert(
      { key, data: upload, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, channel });
}
