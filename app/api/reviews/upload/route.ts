import { type NextRequest } from "next/server";
import { reviewsDb, REVIEW_MEDIA_BUCKET, verifyReviewToken } from "@/lib/reviews/core";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE = 12 * 1024 * 1024;   // 12MB
const MAX_VIDEO = 100 * 1024 * 1024;  // 100MB (숏폼)
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm"];

function extFor(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  };
  return map[mime] || "bin";
}

/** 익명 고객 미디어 업로드 (리뷰 작성용). 토큰으로 mall 식별. */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") || "";
  const tok = verifyReviewToken(token);
  if (!tok) return Response.json({ error: "invalid or expired link" }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: "bad form data" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no file" }, { status: 400 });

  const mime = file.type || "";
  const isImage = IMAGE_MIME.includes(mime);
  const isVideo = VIDEO_MIME.includes(mime);
  if (!isImage && !isVideo) return Response.json({ error: "이미지(JPG/PNG/WEBP) 또는 동영상(MP4/MOV/WEBM)만 가능합니다" }, { status: 415 });
  if (isImage && file.size > MAX_IMAGE) return Response.json({ error: "사진은 12MB 이하" }, { status: 413 });
  if (isVideo && file.size > MAX_VIDEO) return Response.json({ error: "동영상은 100MB 이하" }, { status: 413 });

  const ext = extFor(mime);
  const rand = crypto.randomUUID();
  const path = `${tok.mall}/${tok.productNo}/${rand}.${ext}`;

  const sb = reviewsDb();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await sb.storage.from(REVIEW_MEDIA_BUCKET).upload(path, buf, { contentType: mime, upsert: false });
  if (error) return Response.json({ error: "upload failed: " + error.message }, { status: 500 });

  const { data } = sb.storage.from(REVIEW_MEDIA_BUCKET).getPublicUrl(path);
  return Response.json({ ok: true, url: data.publicUrl, type: isVideo ? "video" : "image", mime });
}
