/**
 * CRM 장바구니 이탈 — 데이터 계층.
 * 자사몰 스크립트가 '담기' 이벤트를 적재(ingestCartEvent), 크론이 미구매분 감지 후 넛지.
 * crm_message_log 로 (패턴·이벤트·단계) 중복 발송 방지.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MallId as Cafe24Mall } from "@/lib/cafe24Client";

export type CrmMall = "paulvice" | "harriot";

/** 위젯몰키(브랜드) → 카페24 토큰 몰키 + 자사몰 도메인. 국내 자사몰은 shop_no 1. */
export const CRM_BRANDS: Record<CrmMall, { cafe24Mall: Cafe24Mall; shopNo: number; storeUrl: string; label: string }> = {
  paulvice: { cafe24Mall: "paulvice", shopNo: 1, storeUrl: "https://paulvice.co.kr", label: "폴바이스" },
  harriot:  { cafe24Mall: "harriot",  shopNo: 1, storeUrl: "https://harriot.co.kr",  label: "해리엇" },
};

export interface CartEventInput {
  mall: CrmMall;
  memberId: string;
  productNo?: number | null;
  productName?: string | null;
  quantity?: number | null;
}

export interface CartEventRow {
  id: string;
  mall: CrmMall;
  shop_no: number;
  member_id: string;
  product_no: number | null;
  product_name: string | null;
  quantity: number;
  cart_at: string;
  converted_at: string | null;
  status: string;
}

let _db: SupabaseClient | null = null;
export function crmDb(): SupabaseClient {
  if (_db) return _db;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 누락");
  _db = createClient(url, key);
  return _db;
}

export function isCrmMall(v: unknown): v is CrmMall {
  return v === "paulvice" || v === "harriot";
}

/**
 * '담기' 이벤트 적재. 같은 (몰·회원·상품)의 active 이벤트가 있으면 담은 시각만 갱신(재담기=재참여),
 * 없으면 새로 insert. → 카트 아이템당 active 1건 유지.
 */
export async function ingestCartEvent(input: CartEventInput): Promise<{ id: string; refreshed: boolean }> {
  const db = crmDb();
  const shopNo = CRM_BRANDS[input.mall].shopNo;
  const now = new Date().toISOString();

  if (input.productNo != null) {
    const { data: existing } = await db
      .from("crm_cart_events")
      .select("id")
      .eq("mall", input.mall)
      .eq("member_id", input.memberId)
      .eq("product_no", input.productNo)
      .eq("status", "active")
      .maybeSingle();
    if (existing?.id) {
      await db
        .from("crm_cart_events")
        .update({ cart_at: now, quantity: input.quantity ?? 1, product_name: input.productName ?? null })
        .eq("id", existing.id);
      return { id: existing.id as string, refreshed: true };
    }
  }

  const { data, error } = await db
    .from("crm_cart_events")
    .insert({
      mall: input.mall,
      shop_no: shopNo,
      member_id: input.memberId,
      product_no: input.productNo ?? null,
      product_name: input.productName ?? null,
      quantity: input.quantity ?? 1,
      cart_at: now,
    })
    .select("id")
    .single();
  if (error) throw new Error(`cart_event insert 실패: ${error.message}`);
  return { id: data.id as string, refreshed: false };
}

/** 단계 발송 멱등 기록. 이미 (패턴·이벤트·단계)가 있으면 false(스킵). */
export async function claimNudge(
  refId: string,
  stage: string,
  meta: { mall: CrmMall; memberId: string; phone?: string; channel?: string },
): Promise<boolean> {
  const db = crmDb();
  const { error } = await db.from("crm_message_log").insert({
    pattern: "cart_abandon",
    ref_id: refId,
    stage,
    mall: meta.mall,
    member_id: meta.memberId,
    phone: meta.phone ?? null,
    channel: meta.channel ?? null,
  });
  if (error) {
    if (error.code === "23505") return false; // 이미 발송
    throw new Error(`nudge log 실패: ${error.message}`);
  }
  return true;
}

export async function markCartStatus(id: string, status: "converted" | "done" | "expired"): Promise<void> {
  const db = crmDb();
  await db
    .from("crm_cart_events")
    .update({ status, ...(status === "converted" ? { converted_at: new Date().toISOString() } : {}) })
    .eq("id", id);
}
