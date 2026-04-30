/**
 * 일회성 백필 — 기존 cafe24_board CS 메시지의 raw 에 상품 정보(cafe24Product) 첨부
 * 및 해당 thread 의 subject 에 상품명 prefix 추가.
 *
 * 동작:
 *   1. cs_messages 에서 channel='cafe24_board' AND direction='in' AND raw.cafe24Product 미존재 인 메시지 fetch
 *   2. raw.article.product_no 추출
 *   3. 상품 단건 조회 (캐시) → raw 갱신 + 같은 thread 의 subject 갱신
 *
 * 사용: GET /api/cs/backfill/cafe24-products?dryRun=1  (먼저 dry run 으로 확인)
 *      GET /api/cs/backfill/cafe24-products            (실제 적용)
 */
import { fetchProduct, type Cafe24Product } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { getCsSupabase } from "@/lib/cs/store";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ArticleSnapshot {
  product_no?: number | null;
  title?: string;
}

interface RawSnapshot {
  board_no?: number;
  board_name?: string;
  article?: ArticleSnapshot;
  cafe24Product?: { productNo: number };
}

function pickProductImage(p: Cafe24Product): string | null {
  return p.list_image ?? p.tiny_image ?? p.detail_image ?? null;
}

export async function GET(req: NextRequest) {
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const limit  = parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10);

  const accessToken = await getAccessTokenFromStore();
  if (!accessToken) {
    return Response.json({ ok: false, error: "Cafe24 토큰 없음" }, { status: 500 });
  }

  const db = getCsSupabase();

  // cafe24_board 의 in 메시지만 가져옴
  const { data: messages, error: mErr } = await db
    .from("cs_messages")
    .select("id, thread_id, raw, external_thread_id")
    .eq("channel", "cafe24_board")
    .eq("direction", "in")
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (mErr) {
    return Response.json({ ok: false, error: mErr.message }, { status: 500 });
  }

  let scanned = 0;
  let alreadyHadProduct = 0;
  let noProductNo = 0;
  let updated = 0;
  let productFetchFailed = 0;
  const errors: string[] = [];
  const productCache = new Map<number, Cafe24Product | null>();

  for (const msg of messages ?? []) {
    scanned++;
    const raw = (msg.raw ?? null) as RawSnapshot | null;
    if (!raw) { noProductNo++; continue; }

    if (raw.cafe24Product?.productNo) {
      alreadyHadProduct++;
      continue;
    }

    const productNo = raw.article?.product_no;
    if (!productNo || productNo <= 0) { noProductNo++; continue; }

    // 상품 페치 (캐시)
    let product = productCache.get(productNo);
    if (product === undefined) {
      try { product = await fetchProduct(accessToken, productNo); }
      catch (e) {
        errors.push(`product ${productNo}: ${e instanceof Error ? e.message : String(e)}`);
        product = null;
      }
      productCache.set(productNo, product);
    }
    if (!product) { productFetchFailed++; continue; }

    const productRef = {
      productNo:   product.product_no,
      name:        product.product_name,
      imageUrl:    pickProductImage(product),
      productCode: product.product_code,
    };

    const newRaw = { ...raw, cafe24Product: productRef };

    if (dryRun) {
      updated++;
      continue;
    }

    // raw 업데이트
    const { error: updErr } = await db
      .from("cs_messages")
      .update({ raw: newRaw })
      .eq("id", msg.id);
    if (updErr) {
      errors.push(`message ${msg.id} update: ${updErr.message}`);
      continue;
    }

    // 같은 thread 의 subject 갱신 (상품명 prefix) — 기존 subject 가 '[게시판명] ...' 형태라 가정
    if (product.product_name && raw.board_name) {
      const shortName = product.product_name.length > 25
        ? product.product_name.slice(0, 25) + "…"
        : product.product_name;
      const newPrefix = `[${raw.board_name} · ${shortName}]`;

      const { data: thread } = await db
        .from("cs_threads")
        .select("subject")
        .eq("id", msg.thread_id)
        .maybeSingle();
      const oldSubject = (thread?.subject as string | null) ?? "";
      // 이미 새 prefix 면 skip
      if (oldSubject && !oldSubject.startsWith(newPrefix)) {
        // 기존 prefix `[게시판명]` 만 자르고 새 prefix 로 교체
        const stripped = oldSubject.replace(new RegExp(`^\\[${raw.board_name}\\]\\s*`), "");
        const newSubject = `${newPrefix} ${stripped}`;
        await db
          .from("cs_threads")
          .update({ subject: newSubject })
          .eq("id", msg.thread_id);
      }
    }

    updated++;
  }

  return Response.json({
    ok: true,
    dryRun,
    scanned,
    alreadyHadProduct,
    noProductNo,
    productFetchFailed,
    updated,
    productCacheHits: productCache.size,
    errors: errors.slice(0, 10),
  });
}
