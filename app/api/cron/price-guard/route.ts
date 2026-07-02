export const maxDuration = 300;

/**
 * 가격 가드 — 혜택(기간할인) 만료로 할인가가 조용히 사라지는 사고 감지.
 *
 * 배경: 2026-06-30 "신상 할인"(에끌라 27%) 만료 → 이틀간 정가 노출 → 주문 급락.
 *       혜택 API는 앱 scope 없어(403) 설정을 못 읽으므로, 매일 실제 할인적용가를
 *       스냅샷해 전일과 비교하는 방식으로 감시한다.
 *
 * 동작: 진열중 상품 전체의 discountprice 조회 → kv `price_guard_snapshot` 와 비교
 *   - 할인 소멸(어제 할인 있었는데 오늘 없음) → 🔴 텔레그램 즉시 알림
 *   - 판매가 자체 변동 → 정보성 표기(같은 알림에 포함)
 *   - 새 스냅샷 저장
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get } from "@/lib/cafe24Client";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { withCron } from "@/lib/cron/withCron";

const SNAP_KEY = "price_guard_snapshot";

type Snap = Record<string, { name: string; price: number; disc: number }>;

function kv() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cronMain(_req: Request): Promise<Response> {
  const token = await getAccessTokenFromStore("paulvice");
  if (!token) throw new Error("cafe24 토큰 없음");
  const sb = kv();
  if (!sb) throw new Error("Supabase 미설정");

  // 1) 진열중 상품 전체
  const products: Array<{ product_no: number; product_name: string; price: string }> = [];
  for (let offset = 0; ; offset += 100) {
    const j = (await cafe24Get(
      `/api/v2/admin/products?shop_no=1&limit=100&offset=${offset}&display=T&fields=product_no,product_name,price`,
      token,
    )) as { products?: Array<{ product_no: number; product_name: string; price: string }> };
    const page = j.products ?? [];
    products.push(...page);
    if (page.length < 100) break;
  }

  // 2) 할인적용가 수집
  const now: Snap = {};
  for (const p of products) {
    try {
      const j = (await cafe24Get(`/api/v2/admin/products/${p.product_no}/discountprice?shop_no=1`, token)) as {
        discountprice?: { pc_discount_price?: string };
      };
      const price = Math.round(parseFloat(p.price || "0"));
      const rawDisc = Math.round(parseFloat(j.discountprice?.pc_discount_price || "0"));
      // discountprice=0 은 API 특이값(실제 0원 아님) → 할인 없음으로 간주
      const disc = rawDisc > 0 && rawDisc < price ? rawDisc : price;
      now[String(p.product_no)] = { name: p.product_name.slice(0, 30), price, disc };
    } catch { /* 개별 실패 스킵 */ }
    await sleep(120);
  }

  // 3) 전일 스냅샷과 비교
  const { data: prevRow } = await sb.from("kv_store").select("data").eq("key", SNAP_KEY).maybeSingle();
  const prev = (prevRow?.data ?? {}) as Snap;
  const lost: string[] = [];
  const priceChanged: string[] = [];
  for (const [no, cur] of Object.entries(now)) {
    const old = prev[no];
    if (!old) continue;
    const hadDisc = old.disc < old.price;
    const hasDisc = cur.disc < cur.price;
    if (hadDisc && !hasDisc) {
      lost.push(`- [${no}] ${cur.name}: ${old.disc.toLocaleString()}원 → ${cur.price.toLocaleString()}원 (할인 소멸)`);
    } else if (old.price !== cur.price) {
      priceChanged.push(`- [${no}] ${cur.name}: 판매가 ${old.price.toLocaleString()} → ${cur.price.toLocaleString()}`);
    }
  }

  // 4) 알림
  if (lost.length) {
    await sendTelegramMessage(
      `🔴 폴바이스 할인 소멸 감지 (${lost.length}종)\n` +
      `혜택(기간할인) 만료 가능성 — 관리자 프로모션→혜택 관리에서 기간 확인하세요.\n\n` +
      lost.slice(0, 15).join("\n") +
      (lost.length > 15 ? `\n…외 ${lost.length - 15}종` : "") +
      (priceChanged.length ? `\n\nℹ️ 판매가 변동 ${priceChanged.length}종:\n` + priceChanged.slice(0, 5).join("\n") : ""),
    );
  }

  // 5) 스냅샷 저장
  await sb.from("kv_store").upsert(
    { key: SNAP_KEY, data: now, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  const discCount = Object.values(now).filter((v) => v.disc < v.price).length;
  return NextResponse.json({ ok: true, scanned: Object.keys(now).length, discounted: discCount, lost: lost.length, priceChanged: priceChanged.length });
}

export const GET = withCron("price-guard", cronMain);
