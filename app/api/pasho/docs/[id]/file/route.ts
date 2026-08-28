import { getDoc, signedUrl } from "@/lib/pasho/docs";

export const dynamic = "force-dynamic";

/**
 * GET /api/pasho/docs/:id/file — 원본 열람.
 * 버킷이 비공개라 여기서 단기 서명URL을 만들어 리다이렉트한다.
 * 이 라우트 자체는 proxy.ts 로그인 게이트 안쪽(ALLOW_PREFIX 아님)이라 세션 없으면 /login 으로 튕긴다.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDoc(id);
  if (!doc) return Response.json({ ok: false, error: "증빙 없음" }, { status: 404 });
  const url = await signedUrl(doc.path, 600);
  if (!url) return Response.json({ ok: false, error: "서명URL 생성 실패" }, { status: 500 });
  return Response.redirect(url, 302);
}
