/**
 * 스토어프론트 리뷰 위젯 데이터 (공개 읽기).
 * 카페24 상품후기 게시판(기본 board 4)에서 product_no 리뷰를 읽어 위젯용 JSON 반환.
 * paulvice.co.kr 등 스토어프론트의 위젯 JS 가 cross-origin fetch → CORS 허용.
 * 리뷰에이드 같은 유료앱 대체용. 사진=attach_file_urls.
 *
 *   GET /api/reviews/widget?product_no=196&mall=paulvice&board=4&limit=50
 */
import { type NextRequest } from "next/server";
import { cafe24Get, type MallId } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // 스토어프론트 캐시(엣지 5분) — 매 페이지뷰마다 카페24 API 안 때리게
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

interface Cafe24ReviewArticle {
  article_no: number;
  parent_article_no?: number | null;
  product_no?: number | null;
  rating?: number;
  content?: string;
  writer?: string;
  nick_name?: string;
  created_date?: string;
  display?: "T" | "F";
  deleted?: "T" | "F";
  secret?: "T" | "F";
  attach_file_urls?: Array<{ no?: number; name?: string; url?: string }> | string | null;
}

/** HTML 제거 + 네이버페이 자동등록 꼬리말 정리 */
function cleanContent(html?: string): string {
  let t = (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  // "(2026-06-11 21:36:54 에 등록된 네이버페이 구매평)" 류 꼬리 제거
  t = t.replace(/\(?\s*\d{4}-\d{2}-\d{2}[^)]*에 등록된[^)]*\)?\s*$/, "").trim();
  return t;
}

/** 이름 마스킹: 김은영 → 김*영, 박민 → 박*, 영문/구매자명 등은 그대로 일부만 */
function maskName(name?: string): string {
  const n = (name ?? "").trim();
  if (!n) return "구매자";
  if (/구매자|페이/.test(n)) return n; // "네이버 페이 구매자" 등은 그대로
  if (n.length <= 1) return n + "*";
  if (n.length === 2) return n[0] + "*";
  return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
}

function normalizePhotos(a: Cafe24ReviewArticle): string[] {
  const raw = a.attach_file_urls;
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((f) => (f && typeof f === "object" ? f.url : undefined))
    .filter((u): u is string => !!u)
    .map((u) => (u.startsWith("//") ? "https:" + u : u));
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const productNo = Number(sp.get("product_no") || 0);
  const mall: MallId = sp.get("mall") === "harriot" ? "harriot" : "paulvice";
  const boardNo = Number(sp.get("board") || 4);
  const limit = Math.min(Number(sp.get("limit") || 50), 100);

  if (!productNo) {
    return Response.json({ ok: false, error: "product_no required" }, { status: 400, headers: CORS });
  }

  let token: string | null = null;
  try {
    token = await getAccessTokenFromStore(mall);
  } catch { /* fallthrough */ }
  if (!token) {
    return Response.json({ ok: false, error: "cafe24 token 없음", reviews: [], summary: { count: 0 } }, { status: 200, headers: CORS });
  }

  try {
    const json = (await cafe24Get(
      `/api/v2/admin/boards/${boardNo}/articles?product_no=${productNo}&limit=${limit}&offset=0`,
      token,
      mall,
    )) as { articles?: Cafe24ReviewArticle[] };

    const articles = (json.articles ?? []).filter(
      (a) =>
        !a.parent_article_no &&            // 운영자 답글 제외 (원글만)
        a.deleted !== "T" &&
        a.display !== "F" &&
        a.secret !== "T",
    );

    const reviews = articles
      .map((a) => ({
        id: a.article_no,
        rating: Number(a.rating) || 0,
        content: cleanContent(a.content),
        author: maskName(a.nick_name || a.writer),
        date: (a.created_date || "").slice(0, 10),
        photos: normalizePhotos(a),
      }))
      .filter((r) => r.content || r.photos.length); // 빈 리뷰 제외

    const count = reviews.length;
    const rated = reviews.filter((r) => r.rating > 0);
    const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : 0;
    const photoCount = reviews.filter((r) => r.photos.length).length;

    return Response.json(
      {
        ok: true,
        product_no: productNo,
        summary: { count, avg: Math.round(avg * 10) / 10, photoCount },
        reviews,
      },
      { status: 200, headers: CORS },
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), reviews: [], summary: { count: 0 } },
      { status: 200, headers: CORS },
    );
  }
}
