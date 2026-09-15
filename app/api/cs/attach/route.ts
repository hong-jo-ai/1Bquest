/**
 * 운영자 첨부 업로드 — 인박스에서 답장에 사진을 붙일 때 쓴다.
 *
 * ⚠️ 방문자용 `/api/cs/webchat/upload` 를 재사용하면 안 된다. 그쪽은
 *   ①`proxy.ts` ALLOW_PREFIX 에 `/api/cs/webchat/` 이 있어 **익명 공개**이고
 *   ②업로드와 동시에 `appendWebchatVisitorMessage` 로 **direction:"in"** 메시지를 만든다.
 *   즉 사장님이 보낸 사진이 "고객이 보낸 사진"으로 기록된다.
 * 이 라우트는 ALLOW_PREFIX 에 없으므로 로그인 게이트 뒤에 있고, 메시지를 만들지 않는다.
 * 저장만 하고 URL 을 돌려주면, 실제 발송은 `/api/cs/reply` 의 attachments 로 간다.
 *
 * 버킷·용량·MIME 기준은 방문자 업로드와 동일하게 맞춘다(같은 버킷을 쓰므로 정책이 갈리면 안 된다).
 */
import { getCsSupabase } from "@/lib/cs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CS_ATTACHMENT_BUCKET = "cs-attachments";
const MAX_IMAGE = 12 * 1024 * 1024; // 12MB — 방문자 업로드와 동일 기준
const IMAGE_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** 경로에 그대로 못 쓰는 문자 제거 — 한글 파일명이 깨져 업로드가 실패하던 것 방지. */
function safeName(name: string): string {
  return name.replace(/[\r\n"\\]/g, "").slice(0, 120);
}

export async function POST(req: Request) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return Response.json({ ok: false, error: "bad form data" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: "파일이 없습니다" }, { status: 400 });
    }
    const mime = file.type || "";
    const ext = IMAGE_MIME[mime];
    if (!ext) {
      return Response.json(
        { ok: false, error: "이미지만 첨부할 수 있습니다 (JPG/PNG/WEBP/GIF/HEIC)" },
        { status: 415 },
      );
    }
    if (file.size > MAX_IMAGE) {
      return Response.json({ ok: false, error: "최대 12MB 까지 첨부할 수 있습니다" }, { status: 413 });
    }

    // threadId 는 경로 분류용일 뿐(없어도 업로드는 된다). 값 검증은 느슨하게.
    const threadId = String(form.get("threadId") ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
    const path = `operator/${threadId || "misc"}/${crypto.randomUUID()}.${ext}`;

    const sb = getCsSupabase();
    const buf = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await sb.storage
      .from(CS_ATTACHMENT_BUCKET)
      .upload(path, buf, { contentType: mime, upsert: false });
    if (uploadError) {
      return Response.json({ ok: false, error: `업로드 실패: ${uploadError.message}` }, { status: 500 });
    }
    const { data: pub } = sb.storage.from(CS_ATTACHMENT_BUCKET).getPublicUrl(path);

    // 인박스·웹챗 위젯이 모두 읽는 형태({url,name,isImage})로 돌려준다.
    return Response.json({
      ok: true,
      url: pub.publicUrl,
      name: safeName(file.name) || undefined,
      isImage: true,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error }, { status: 500 });
  }
}
