import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BASE_URL = `https://${process.env.CAFE24_MALL_ID}.cafe24api.com`;

/**
 * GET /api/cs/debug/cafe24/article?board=6&article=516
 * 특정 article의 raw 데이터를 그대로 반환
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const boardNo = url.searchParams.get("board") ?? "6";
  const articleNo = url.searchParams.get("article") ?? "0";

  const accessToken = await getAccessTokenFromStore();
  if (!accessToken) return Response.json({ error: "no token" }, { status: 401 });

  const results: Record<string, unknown> = {};

  // 1. 직접 article 조회
  try {
    const res = await fetch(
      `${BASE_URL}/api/v2/admin/boards/${boardNo}/articles/${articleNo}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Cafe24-Api-Version": "2026-03-01",
        },
      }
    );
    results.directArticle = {
      status: res.status,
      body: await res.text(),
    };
  } catch (e) {
    results.directArticleError = e instanceof Error ? e.message : String(e);
  }

  // 2. 해당 article의 comments 조회 (답변이 comment로 저장됐는지 확인)
  try {
    const res = await fetch(
      `${BASE_URL}/api/v2/admin/boards/${boardNo}/articles/${articleNo}/comments`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Cafe24-Api-Version": "2026-03-01",
        },
      }
    );
    results.comments = {
      status: res.status,
      body: await res.text(),
    };
  } catch (e) {
    results.commentsError = e instanceof Error ? e.message : String(e);
  }

  // 3. parent_article_no=516으로 다른 article 조회 (답변이 자식 글로 저장됐는지)
  try {
    const res = await fetch(
      `${BASE_URL}/api/v2/admin/boards/${boardNo}/articles?parent_article_no=${articleNo}&limit=10`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Cafe24-Api-Version": "2026-03-01",
        },
      }
    );
    results.childArticles = {
      status: res.status,
      body: await res.text(),
    };
  } catch (e) {
    results.childArticlesError = e instanceof Error ? e.message : String(e);
  }

  // 4. 최근 article 리스트를 reply_depth>0 포함해서 보기
  try {
    const res = await fetch(
      `${BASE_URL}/api/v2/admin/boards/${boardNo}/articles?limit=30&start_date=2026-04-01&end_date=2026-04-15`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Cafe24-Api-Version": "2026-03-01",
        },
      }
    );
    const json = JSON.parse(await res.text()) as {
      articles?: Array<{
        article_no: number;
        parent_article_no?: number | null;
        reply_depth?: number;
        title: string;
        writer?: string;
      }>;
    };
    results.articleList = {
      status: res.status,
      allArticles: json.articles?.map((a) => ({
        article_no: a.article_no,
        parent: a.parent_article_no,
        depth: a.reply_depth,
        title: a.title,
        writer: a.writer,
      })),
    };
  } catch (e) {
    results.articleListError = e instanceof Error ? e.message : String(e);
  }

  return Response.json(results);
}
