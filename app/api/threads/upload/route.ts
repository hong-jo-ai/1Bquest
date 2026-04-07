import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_SIZE = 50 * 1024 * 1024; // 50MB (영상 포함)
const BUCKET = "threads-media";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * POST /api/threads/upload
 * FormData: file (image or video)
 * Returns: { url, mediaType }
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ error: "스토리지 미설정" }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "파일 파싱 실패" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return Response.json({ error: "파일이 없습니다" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return Response.json({ error: "파일 크기는 50MB 이하만 가능합니다" }, { status: 413 });
  }

  // 미디어 타입 판별
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) {
    return Response.json({ error: "이미지 또는 영상 파일만 업로드 가능합니다" }, { status: 415 });
  }

  const ext = file.name.split(".").pop() ?? (isImage ? "jpg" : "mp4");
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    // 버킷 존재 확인 및 생성 (public 보장)
    const { data: buckets } = await supabase.storage.listBuckets();
    const existing = buckets?.find((b) => b.name === BUCKET);
    if (!existing) {
      await supabase.storage.createBucket(BUCKET, { public: true });
    } else if (!existing.public) {
      await supabase.storage.updateBucket(BUCKET, { public: true });
    }

    const buffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(fileName);

    return Response.json({
      url: urlData.publicUrl,
      mediaType: isImage ? "IMAGE" : "VIDEO",
      fileName,
    });
  } catch (e: any) {
    console.error("[Threads upload]", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
