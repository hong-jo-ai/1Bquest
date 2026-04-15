import { cafe24Get } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/cs/debug/cafe24
 * Cafe24 토큰 상태 + 게시판 목록 raw 응답 확인
 */
export async function GET() {
  const result: Record<string, unknown> = {};

  // 1. 토큰
  const accessToken = await getAccessTokenFromStore();
  result.hasToken = !!accessToken;
  if (!accessToken) {
    result.hint = "Supabase kv_store에 cafe24_refresh_token 없음 → 대시보드에서 Cafe24 로그인 필요";
    return Response.json(result);
  }
  result.tokenStart = accessToken.slice(0, 20) + "...";

  // 2. 게시판 목록 raw
  try {
    const boards = await cafe24Get(
      "/api/v2/admin/boards?limit=100",
      accessToken
    );
    result.boards = boards;
  } catch (e) {
    result.boardsError = e instanceof Error ? e.message : String(e);
  }

  // 3. 게시판 1개 직접 조회 (board_no=1은 대부분 공지사항)
  try {
    const articles = await cafe24Get(
      "/api/v2/admin/boards/4/articles?limit=5",
      accessToken
    );
    result.board4articles = articles;
  } catch (e) {
    result.board4error = e instanceof Error ? e.message : String(e);
  }

  return Response.json(result);
}
