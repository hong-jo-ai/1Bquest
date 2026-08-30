import { type NextRequest } from "next/server";
import { reviewsDb, verifyReviewToken, getMall, rewardFor, paidAmountForReview, type MediaType } from "@/lib/reviews/core";
import { cafe24Post } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

export const runtime = "nodejs";

interface MediaItem { type: "image" | "video"; url: string }

function buildContent(text: string, media: MediaItem[]): string {
  const safe = (text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  let html = `<div style="font-size:15px;line-height:1.8;color:#333;">${safe}`;
  for (const m of media) {
    if (m.type === "video") {
      html += `<div style="margin-top:14px;"><video src="${m.url}" controls playsinline style="max-width:100%;border-radius:8px;"></video></div>`;
    } else {
      html += `<div style="margin-top:14px;"><img src="${m.url}" alt="" style="max-width:100%;border-radius:8px;"></div>`;
    }
  }
  return html + `</div>`;
}

function title(text: string, productName: string): string {
  const t = (text || "").split(/[.!?\n]/)[0].trim();
  if (t.length >= 6) return t.length > 58 ? t.slice(0, 55).trim() + "…" : t;
  return `Review — ${productName}`.slice(0, 60);
}

/** 익명 고객 리뷰 제출 → 저장(자동게시) + 카페24 후기 자동게시(베스트에포트). */
export async function POST(req: NextRequest) {
  let body: { token?: string; rating?: number; content?: string; name?: string; media?: MediaItem[] };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const tok = verifyReviewToken(body.token || "");
  if (!tok) return Response.json({ error: "invalid or expired link" }, { status: 401 });
  const mall = getMall(tok.mall)!;

  const rating = Math.min(5, Math.max(1, Math.round(Number(body.rating) || 0)));
  if (!rating) return Response.json({ error: "별점을 선택해 주세요 / Please select a rating" }, { status: 400 });

  const media: MediaItem[] = Array.isArray(body.media) ? body.media.filter((m) => m && (m.type === "image" || m.type === "video") && typeof m.url === "string").slice(0, 10) : [];
  const mediaType: MediaType = media.some((m) => m.type === "video") ? "video" : media.some((m) => m.type === "image") ? "photo" : "none";
  const writer = (body.name || tok.name || "Verified Buyer").toString().slice(0, 40);
  const content = (body.content || "").toString().slice(0, 4000);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";

  const sb = reviewsDb();

  // 중복 방지 — 같은 주문(없으면 전화/이메일+상품)으로 이미 작성했으면 보상 중복 없이 안내.
  const phoneDigits = tok.phone ? tok.phone.replace(/\D/g, "") : null;
  if (tok.orderRef || phoneDigits || tok.email) {
    let dq = sb.from("reviews").select("id, reward_points").eq("mall", mall.id).limit(1);
    if (tok.orderRef) dq = dq.eq("order_ref", tok.orderRef);
    else if (phoneDigits) dq = dq.eq("customer_phone", phoneDigits).eq("product_no", tok.productNo);
    else dq = dq.eq("customer_email", tok.email!).eq("product_no", tok.productNo);
    const { data: dup } = await dq;
    if (dup && dup.length > 0) {
      return Response.json({ ok: true, duplicate: true, reward: dup[0].reward_points ?? 0, published: true });
    }
  }

  // 적립금은 실결제가 비율로 준다. 주문 조회가 실패해도 후기는 저장되고, 그 경우 정액으로 폴백한다.
  const paid = await paidAmountForReview(mall, tok.orderRef, tok.productNo);

  const row = {
    mall: mall.id, cafe24_shop_no: mall.shopNo, product_no: tok.productNo, product_name: tok.productName,
    order_ref: tok.orderRef || null, customer_name: writer, customer_email: tok.email || null,
    customer_phone: tok.phone || null,
    rating, content, media, media_type: mediaType, reward_points: rewardFor(mall, mediaType, paid),
    status: "published", reward_status: "pending", source: "review_app", ip,
  };
  const { data: inserted, error } = await sb.from("reviews").insert(row).select("id").single();
  if (error) return Response.json({ error: "save failed: " + error.message }, { status: 500 });

  // ── 베스트에포트: 카페24 상품후기 게시판 자동 게시 ──
  let cafe24ArticleNo: number | null = null;
  try {
    const at = await getAccessTokenFromStore(mall.cafe24Mall);
    if (at) {
      const res = await cafe24Post(`/api/v2/admin/boards/${mall.reviewBoardNo}/articles`, at, {
        shop_no: mall.shopNo,
        requests: [{
          board_category_no: mall.boardCategoryNo,
          product_no: tok.productNo,
          writer, nick_name: writer,
          title: title(content, tok.productName),
          content: buildContent(content, media),
          rating,
          client_ip: ip === "0.0.0.0" ? "127.0.0.1" : ip,
        }],
      }, mall.cafe24Mall);
      cafe24ArticleNo = res?.articles?.[0]?.article_no ?? null;
    }
  } catch (e) {
    console.error("[reviews] cafe24 publish 실패:", e instanceof Error ? e.message : e);
  }
  if (cafe24ArticleNo) {
    await sb.from("reviews").update({ cafe24_article_no: cafe24ArticleNo, cafe24_synced: true }).eq("id", inserted.id);
  }

  return Response.json({ ok: true, id: inserted.id, reward: row.reward_points, published: !!cafe24ArticleNo });
}
