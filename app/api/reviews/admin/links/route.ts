/**
 * 리뷰 상품 연동 관리 — review_link_groups.
 * 같은 group_key 를 가진 상품들끼리 리뷰를 합쳐서 노출(widget groupProductNos).
 * 전시안함/단종 상품에 달린 리뷰를 활성 상품에 함께 보이게 연결하는 용도.
 *
 * GET  ?mall=&q=      상품 검색 + 리뷰수·전시상태·현재 연동그룹
 * POST { mall, productNos[], groupKey? }   선택 상품들을 한 그룹으로 연동
 * DELETE { mall, productNo }                연동 해제
 */
import { type NextRequest } from "next/server";
import { getMall } from "@/lib/reviews/core";
import { cafe24Get } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function db() { return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!); }
// review_link_groups.mall = "harriot" | "paulvice" (cafe24Mall과 동일)
function normMall(m: string): "harriot" | "paulvice" { return m === "harriot" ? "harriot" : "paulvice"; }
function mallRowKey(m: string): string { return m === "harriot" ? "harriot_kr" : "paulvice_kr"; }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mall = normMall(sp.get("mall") || "paulvice");
  const q = (sp.get("q") || "").trim();
  const shopNo = getMall(mall === "harriot" ? "harriot_kr" : "paulvice_kr")?.shopNo || 1;

  const at = await getAccessTokenFromStore(mall);
  if (!at) return Response.json({ ok: false, error: "cafe24 토큰 없음", products: [] });

  const qs = new URLSearchParams({ shop_no: String(shopNo), limit: "30", fields: "product_no,product_name,display,selling" });
  if (q) qs.set("product_name", q);
  const pj = (await cafe24Get(`/api/v2/admin/products?${qs}`, at, mall)) as { products?: Array<{ product_no: number; product_name: string; display: string; selling: string }> };
  const products = pj.products || [];
  const pnos = products.map((p) => p.product_no);

  const sb = db();
  const [{ data: groups }, { data: chRows }] = await Promise.all([
    sb.from("review_link_groups").select("product_no,group_key").eq("mall", mall).in("product_no", pnos.length ? pnos : [-1]),
    sb.from("channel_reviews").select("product_no").eq("mall", mallRowKey(mall)).in("product_no", pnos.length ? pnos : [-1]),
  ]);
  const groupMap = new Map((groups || []).map((g) => [g.product_no, g.group_key]));
  const chMap = new Map<number, number>();
  for (const c of chRows || []) chMap.set(c.product_no, (chMap.get(c.product_no) || 0) + 1);

  // 상품별 cafe24 게시판 리뷰수 + 채널 리뷰수
  const out = [];
  for (const p of products) {
    let board = 0;
    try {
      const c = (await cafe24Get(`/api/v2/admin/boards/4/articles?shop_no=${shopNo}&product_no=${p.product_no}&limit=100&fields=article_no,parent_article_no`, at, mall)) as { articles?: Array<{ parent_article_no?: number }> };
      board = (c.articles || []).filter((a) => !a.parent_article_no).length; // 답글 제외
    } catch { /* 카운트 실패 시 0 */ }
    out.push({
      product_no: p.product_no, product_name: p.product_name,
      display: p.display === "T", selling: p.selling === "T",
      reviewCount: board + (chMap.get(p.product_no) || 0),
      group_key: groupMap.get(p.product_no) || null,
    });
  }
  return Response.json({ ok: true, products: out });
}

export async function POST(req: NextRequest) {
  let body: { mall?: string; productNos?: number[]; groupKey?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const mall = normMall(body.mall || "paulvice");
  const productNos = (body.productNos || []).filter((n) => Number.isFinite(n));
  if (productNos.length < 2) return Response.json({ error: "연동할 상품을 2개 이상 선택하세요" }, { status: 400 });

  const sb = db();
  let groupKey = (body.groupKey || "").trim();
  if (!groupKey) {
    // 선택 상품 중 이미 그룹이 있으면 그 그룹에 합침, 없으면 새 그룹
    const { data: ex } = await sb.from("review_link_groups").select("group_key").eq("mall", mall).in("product_no", productNos).limit(1);
    groupKey = ex?.[0]?.group_key || `grp_${mall}_${Date.now().toString(36)}`;
  }
  // 기존 배정 제거 후 재삽입(멱등)
  await sb.from("review_link_groups").delete().eq("mall", mall).in("product_no", productNos);
  const { error } = await sb.from("review_link_groups").insert(productNos.map((pn) => ({ mall, group_key: groupKey, product_no: pn })));
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, groupKey, count: productNos.length });
}

export async function DELETE(req: NextRequest) {
  let body: { mall?: string; productNo?: number };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const mall = normMall(body.mall || "paulvice");
  if (!body.productNo) return Response.json({ error: "productNo 필요" }, { status: 400 });
  const { error } = await db().from("review_link_groups").delete().eq("mall", mall).eq("product_no", body.productNo);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
