export const maxDuration = 300;

/**
 * 리뷰 카운트 집계 크론 — 위젯과 동일 기준(자사몰 board4 + 채널리뷰 + 연결그룹 합산)의
 * 상품별 리뷰수를 kv `review_counts:paulvice` 에 저장. 표시 일원화용:
 * 상세 플로팅 배지({$review_count}=자사몰만)·watchshop 타일(cafe24 review_cnt) 불일치 해소.
 *
 * board4 전체를 offset 페이지네이션으로 1회 스캔(~30콜) 후 product_no 별 집계 —
 * 상품별 개별 조회보다 훨씬 저렴.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { cafe24Get } from "@/lib/cafe24Client";
import { withCron } from "@/lib/cron/withCron";

const KV_KEY = "review_counts:paulvice";

function kv() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

interface Article {
  article_no: number;
  parent_article_no?: number | null;
  product_no?: number | null;
  display?: string;
  deleted?: string;
  secret?: string;
}

async function cronMain(_req: Request): Promise<Response> {
  const token = await getAccessTokenFromStore("paulvice");
  if (!token) throw new Error("cafe24 토큰 없음");
  const sb = kv();
  if (!sb) throw new Error("Supabase 미설정");

  // 1) board4 전체 스캔 → 상품별 자사몰 리뷰수
  const own: Record<string, number> = {};
  for (let offset = 0; offset < 20000; offset += 100) {
    const j = (await cafe24Get(
      `/api/v2/admin/boards/4/articles?shop_no=1&limit=100&offset=${offset}`,
      token,
    )) as { articles?: Article[] };
    const page = j.articles ?? [];
    for (const a of page) {
      if (a.parent_article_no || a.deleted === "T" || a.display === "F" || a.secret === "T") continue;
      if (!a.product_no) continue;
      const k = String(a.product_no);
      own[k] = (own[k] || 0) + 1;
    }
    if (page.length < 100) break;
  }

  // 2) 채널 리뷰수 (channel_reviews, mall=paulvice_kr)
  const channel: Record<string, number> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("channel_reviews")
      .select("product_no")
      .eq("mall", "paulvice_kr")
      .range(from, from + 999);
    if (error) break;
    for (const r of data ?? []) {
      if (!r.product_no) continue;
      const k = String(r.product_no);
      channel[k] = (channel[k] || 0) + 1;
    }
    if (!data || data.length < 1000) break;
  }

  // 3) 연결그룹 합산 (같은 group_key 상품들은 합계를 공유)
  const { data: links } = await sb.from("review_link_groups").select("product_no,group_key").eq("mall", "paulvice");
  const groups: Record<string, number[]> = {};
  for (const l of links ?? []) {
    (groups[l.group_key] = groups[l.group_key] || []).push(Number(l.product_no));
  }
  const base: Record<string, number> = {};
  const all = new Set([...Object.keys(own), ...Object.keys(channel)]);
  for (const k of all) base[k] = (own[k] || 0) + (channel[k] || 0);
  const counts: Record<string, number> = { ...base };
  for (const nos of Object.values(groups)) {
    const sum = nos.reduce((s, n) => s + (base[String(n)] || 0), 0);
    for (const n of nos) counts[String(n)] = sum;
  }

  await sb.from("kv_store").upsert(
    { key: KV_KEY, data: counts, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  return NextResponse.json({ ok: true, products: Object.keys(counts).length, ownTotal: Object.values(own).reduce((a, b) => a + b, 0), channelTotal: Object.values(channel).reduce((a, b) => a + b, 0) });
}

export const GET = withCron("review-counts", cronMain);
