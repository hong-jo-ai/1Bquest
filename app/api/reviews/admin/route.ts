import { type NextRequest } from "next/server";
import { reviewsDb, getMall } from "@/lib/reviews/core";
import { cafe24Put } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 관리자 전용 (proxy 게이트로 보호 — ALLOW_PREFIX 에 없음).

/** 목록 조회 + 상태별 카운트 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mall = sp.get("mall") || "";
  const status = sp.get("status") || "all";
  const productNo = sp.get("product_no");
  const q = (sp.get("q") || "").trim();
  const limit = Math.min(200, Number(sp.get("limit")) || 100);
  const offset = Number(sp.get("offset")) || 0;

  const sb = reviewsDb();
  let query = sb.from("reviews").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (mall) query = query.eq("mall", mall);
  if (status !== "all") query = query.eq("status", status);
  if (productNo) query = query.eq("product_no", Number(productNo));
  if (q) query = query.or(`content.ilike.%${q}%,customer_name.ilike.%${q}%,product_name.ilike.%${q}%`);
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 상태별 카운트(현재 mall 필터 기준)
  const counts: Record<string, number> = { published: 0, hidden: 0, spam: 0, total: 0 };
  let cq = sb.from("reviews").select("status", { count: "exact", head: false });
  if (mall) cq = cq.eq("mall", mall);
  const { data: all } = await cq;
  for (const r of all || []) { counts[r.status as string] = (counts[r.status as string] || 0) + 1; counts.total++; }

  // 외부 채널(무신사·W컨셉·29CM) 수집 리뷰 병합 — 읽기전용. status가 all/published일 때만 노출.
  const CH_LABEL: Record<string, string> = { musinsa: "무신사", "29cm": "29CM", wconcept: "W컨셉" };
  let channelRows: Record<string, unknown>[] = [];
  let channelCount = 0;
  if (status === "all" || status === "published") {
    let chq = sb.from("channel_reviews").select("*", { count: "exact" }).order("review_date", { ascending: false }).range(offset, offset + limit - 1);
    if (mall) chq = chq.eq("mall", mall);
    if (productNo) chq = chq.eq("product_no", Number(productNo));
    if (q) chq = chq.or(`content.ilike.%${q}%,channel_goods_name.ilike.%${q}%,author.ilike.%${q}%`);
    const { data: ch, count: cc } = await chq;
    channelCount = cc || 0;
    channelRows = (ch || []).map((r) => ({
      id: "ch_" + r.id, mall: r.mall, product_no: r.product_no,
      product_name: r.channel_goods_name, customer_name: r.author, customer_email: null,
      rating: r.rating, content: r.content,
      media_type: Array.isArray(r.photos) && r.photos.length ? "photo" : "none",
      media: (Array.isArray(r.photos) ? r.photos : []).map((u: string) => ({ type: "photo", url: u })),
      reward_points: 0, status: "published", cafe24_article_no: null, cafe24_synced: false,
      created_at: r.review_date, source: CH_LABEL[r.channel as string] || r.channel, readonly: true,
    }));
  }
  const merged = [...(data || []), ...channelRows].sort(
    (a, b) => String((b as { created_at?: string }).created_at || "").localeCompare(String((a as { created_at?: string }).created_at || "")),
  );
  counts.channel = channelCount;

  return Response.json({ ok: true, reviews: merged, count: (count || 0) + channelCount, counts });
}

/** 상태 변경 (hide / publish / spam) — 카페24 노출도 동기화 */
export async function POST(req: NextRequest) {
  let body: { id?: string; action?: "hide" | "publish" | "spam" };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  if (!body.id || !["hide", "publish", "spam"].includes(body.action || "")) {
    return Response.json({ error: "id, action(hide|publish|spam) 필요" }, { status: 400 });
  }
  const newStatus = body.action === "publish" ? "published" : body.action === "spam" ? "spam" : "hidden";
  const cafe24Display = body.action === "publish" ? "T" : "F";

  const sb = reviewsDb();
  const { data: row, error } = await sb.from("reviews").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", body.id).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 카페24 게시글 노출/숨김 동기화 (베스트에포트)
  let synced = false;
  if (row?.cafe24_article_no) {
    const mall = getMall(row.mall);
    if (mall) {
      try {
        const at = await getAccessTokenFromStore(mall.cafe24Mall);
        if (at) {
          await cafe24Put(`/api/v2/admin/boards/${mall.reviewBoardNo}/articles/${row.cafe24_article_no}`, at,
            { shop_no: mall.shopNo, request: { display: cafe24Display } }, mall.cafe24Mall);
          synced = true;
        }
      } catch (e) { console.error("[reviews admin] cafe24 동기화 실패:", e instanceof Error ? e.message : e); }
    }
  }
  return Response.json({ ok: true, status: newStatus, cafe24Synced: synced });
}
