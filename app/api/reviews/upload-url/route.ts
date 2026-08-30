/**
 * 리뷰 미디어 업로드 URL 발급 — 브라우저가 Supabase 로 **직접** 올리게 한다.
 *
 * 왜 직접인가: 우리 API 를 거치면 Vercel 함수 페이로드 한도(4.5MB)에 걸린다.
 * 실측(2026-08-30) — 4MB 통과 / 6MB 부터 413 FUNCTION_PAYLOAD_TOO_LARGE.
 * 폰으로 찍은 동영상은 몇 초만 돼도 10MB 를 넘어 **동영상 첨부가 사실상 전부 실패**했다.
 * 고객 문의로 발견. 서명 URL 로 우회하면 파일이 우리 서버를 지나가지 않아 한도와 무관하다.
 *
 * 파일 자체는 안 받고 **올릴 자리만** 내준다. 경로는 토큰에서 뽑아 서버가 정하므로
 * 클라이언트가 남의 폴더에 쓰지 못한다.
 */
import { type NextRequest } from "next/server";
import { reviewsDb, REVIEW_MEDIA_BUCKET, verifyReviewToken } from "@/lib/reviews/core";

export const runtime = "nodejs";

const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm"];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};
/** 일부 안드로이드 브라우저는 file.type 을 빈 문자열로 준다 → 확장자로 보정한다. */
const BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm",
};

export async function POST(req: NextRequest) {
  const tok = verifyReviewToken(req.nextUrl.searchParams.get("t") || "");
  if (!tok) return Response.json({ error: "링크가 만료되었습니다. 문자를 다시 확인해 주세요." }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as { mime?: string; size?: number; filename?: string };
  const extFromName = String(b.filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  const mime = (b.mime && b.mime !== "application/octet-stream" ? b.mime : "") || BY_EXT[extFromName] || "";
  const size = Number(b.size) || 0;

  const isImage = IMAGE_MIME.includes(mime);
  const isVideo = VIDEO_MIME.includes(mime);
  if (!isImage && !isVideo) {
    return Response.json({ error: "사진(JPG·PNG·HEIC) 또는 동영상(MP4·MOV)만 올릴 수 있습니다" }, { status: 415 });
  }
  if (isImage && size > MAX_IMAGE) return Response.json({ error: "사진은 12MB 이하로 올려주세요" }, { status: 413 });
  if (isVideo && size > MAX_VIDEO) {
    return Response.json({ error: "동영상은 100MB 이하로 올려주세요 (길이를 줄이거나 화질을 낮춰주세요)" }, { status: 413 });
  }

  const path = `${tok.mall}/${tok.productNo}/${crypto.randomUUID()}.${EXT[mime]}`;
  const sb = reviewsDb();
  const { data, error } = await sb.storage.from(REVIEW_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error) return Response.json({ error: "업로드 준비 실패: " + error.message }, { status: 500 });

  const { data: pub } = sb.storage.from(REVIEW_MEDIA_BUCKET).getPublicUrl(path);
  return Response.json({
    ok: true,
    uploadUrl: data.signedUrl,
    url: pub.publicUrl,
    type: isVideo ? "video" : "image",
    mime,
  });
}
