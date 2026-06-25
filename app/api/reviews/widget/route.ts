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
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

interface AiSummary { summary: string; keywords: string[] }

/** 실제 후기를 claude-haiku로 요약 + 키워드. kv 캐시(후기수 동일하면 재사용). */
async function getAiSummary(
  mall: MallId,
  productNo: number,
  reviews: Array<{ rating: number; content: string }>,
  count: number,
): Promise<AiSummary | null> {
  const texts = reviews.map((r) => (r.content || "").trim()).filter((t) => t.length >= 4);
  if (texts.length < 3) return null; // 후기 너무 적으면 요약 생략
  const sbUrl = process.env.SUPABASE_URL, sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const sb = sbUrl && sbKey ? createClient(sbUrl, sbKey) : null;
  const cacheKey = `review_ai_summary:v2:${mall}:${productNo}`;

  if (sb) {
    const { data } = await sb.from("kv_store").select("data").eq("key", cacheKey).maybeSingle();
    const c = data?.data as (AiSummary & { count?: number }) | undefined;
    if (c && c.count === count && c.summary) return { summary: c.summary, keywords: c.keywords || [] };
  }
  if (!apiKey) return null;

  try {
    const sample = texts.slice(0, 60).map((t, i) => `${i + 1}. ${t.slice(0, 220)}`).join("\n");
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      system:
        "너는 쇼핑몰 상품 후기를 '구매 전환'에 도움 되도록 요약하는 카피라이터다. 실제 후기에 근거해서만 쓰고 없는 내용은 절대 지어내지 마라(거짓·별점 조작 금지). 단, 다수가 만족한 **장점을 중심으로** 신뢰감 있게 정리하고, 소수의 부정·아쉬운 의견은 **순화하거나 비중을 줄여** 부드럽게 다룬다(완전히 숨기진 말되 짧게, 취향 차이/사소한 점으로 표현). 담백하고 세련된 한국어로만.",
      messages: [
        {
          role: "user",
          content:
            `아래는 이 시계 상품의 실제 고객 후기다. 구매를 고민하는 고객이 사고 싶어지도록 핵심 장점 위주로 요약하라.\n` +
            `규칙: ①다수가 만족한 장점(디자인/마감/착용감/가성비/선물반응 등)을 앞세운다 ②부정·아쉬운 점은 소수의견이면 생략하거나 맨 끝에 아주 짧게 순화해 언급(예: "초침 소리에 민감한 분도 일부 있다" 정도) ③과장·없는 내용 금지.\n` +
            `반드시 이 JSON만:\n{"summary":"2~3문장, 장점 중심·신뢰감 있게","keywords":["자주 언급된 장점 키워드 3~5개(짧게)"]}\n\n후기:\n${sample}`,
        },
      ],
    });
    const raw = (res.content[0] as { text: string }).text.trim();
    const parsed = JSON.parse(raw.startsWith("{") ? raw : raw.replace(/^```json\n?/, "").replace(/\n?```$/, "")) as AiSummary;
    const out: AiSummary = {
      summary: String(parsed.summary || "").trim(),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5).map((k) => String(k).trim()).filter(Boolean) : [],
    };
    if (!out.summary) return null;
    if (sb) {
      await sb.from("kv_store").upsert(
        { key: cacheKey, data: { ...out, count }, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    }
    return out;
  } catch {
    return null;
  }
}

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
  const fix = (u: string) => (u.startsWith("//") ? "https:" + u : u);
  // 1) 카페24 첨부파일
  const raw = a.attach_file_urls;
  const fromAttach = (Array.isArray(raw) ? raw : [])
    .map((f) => (f && typeof f === "object" ? f.url : undefined))
    .filter((u): u is string => !!u)
    .map(fix);
  // 2) 본문 HTML <img> (앱수집·이관 리뷰는 이미지가 본문에 들어감)
  const fromContent: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(a.content || ""))) {
    const u = fix(m[1]);
    if (/^https?:/i.test(u) && !/icon|blank|spacer|emoticon/i.test(u)) fromContent.push(u);
  }
  return [...new Set([...fromAttach, ...fromContent])];
}

/** 상품이 속한 연결그룹의 모든 product_no (없으면 자기 자신만). */
async function groupProductNos(mall: MallId, productNo: number): Promise<number[]> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return [productNo];
  try {
    const sb = createClient(url, key);
    const { data: self } = await sb.from("review_link_groups").select("group_key").eq("mall", mall).eq("product_no", productNo).maybeSingle();
    if (!self?.group_key) return [productNo];
    const { data: members } = await sb.from("review_link_groups").select("product_no").eq("mall", mall).eq("group_key", self.group_key);
    const nos = (members || []).map((r) => Number(r.product_no)).filter(Boolean);
    return nos.length ? nos : [productNo];
  } catch { return [productNo]; }
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
    // 연결그룹: 색상만 다른 같은 컬렉션 등은 묶인 상품들의 리뷰를 함께 노출.
    const productNos = await groupProductNos(mall, productNo);
    const seen = new Set<number>();
    const articles: Cafe24ReviewArticle[] = [];
    for (const pno of productNos) {
      const json = (await cafe24Get(
        `/api/v2/admin/boards/${boardNo}/articles?product_no=${pno}&limit=${limit}&offset=0`,
        token,
        mall,
      )) as { articles?: Cafe24ReviewArticle[] };
      for (const a of json.articles ?? []) {
        if (a.parent_article_no || a.deleted === "T" || a.display === "F" || a.secret === "T") continue;
        if (seen.has(a.article_no)) continue;
        seen.add(a.article_no);
        articles.push(a);
      }
    }

    const reviews = articles
      .map((a) => ({
        id: a.article_no,
        rating: Number(a.rating) || 0,
        content: cleanContent(a.content),
        author: maskName(a.nick_name || a.writer),
        date: (a.created_date || "").slice(0, 10),
        photos: normalizePhotos(a),
      }))
      .filter((r) => r.content || r.photos.length) // 빈 리뷰 제외
      .sort((a, b) => (b.date || "").localeCompare(a.date || "")); // 최신순

    const count = reviews.length;
    const rated = reviews.filter((r) => r.rating > 0);
    const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : 0;
    const photoCount = reviews.filter((r) => r.photos.length).length;
    // 별점 분포 (5→1)
    const dist: Record<string, number> = { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 };
    rated.forEach((r) => { const k = String(Math.min(5, Math.max(1, Math.round(r.rating)))); dist[k] = (dist[k] || 0) + 1; });

    let aiSummary: AiSummary | null = null;
    try { aiSummary = await getAiSummary(mall, productNo, reviews, count); } catch { /* 요약 실패해도 위젯은 정상 */ }

    return Response.json(
      {
        ok: true,
        product_no: productNo,
        summary: { count, avg: Math.round(avg * 10) / 10, photoCount, distribution: dist },
        aiSummary,
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
