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
  /** 로그인 회원이면 회원ID. 비로그인은 null 이고 anonId 로 식별한다. */
  memberId?: string | null;
  /** 브라우저에 심은 임의 식별자(개인정보 아님). 비로그인 추적의 유일한 축. */
  anonId?: string | null;
  productNo?: number | null;
  productName?: string | null;
  quantity?: number | null;
}

export interface CartEventRow {
  id: string;
  mall: CrmMall;
  shop_no: number;
  member_id: string | null;
  anon_id: string | null;
  order_id: string | null;
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
  // 회원이면 회원ID, 아니면 익명ID 로 같은 사람을 묶는다.
  // 둘 다 없으면 누가 담았는지 알 수 없어 집계에 쓸모가 없다.
  const idCol = input.memberId ? "member_id" : "anon_id";
  const idVal = input.memberId || input.anonId;
  if (!idVal) throw new Error("memberId 또는 anonId 필요");

  if (input.productNo != null) {
    const { data: existing } = await db
      .from("crm_cart_events")
      .select("id")
      .eq("mall", input.mall)
      .eq(idCol, idVal)
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
      member_id: input.memberId || null,
      anon_id: input.anonId || null,
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


/**
 * 구매 도달 처리 — 주문완료 페이지에 닿으면 그 사람의 열린 담기를 전환으로 닫는다.
 *
 * 왜 페이지에서 받는가: 비로그인 구매가 절반이라(최근 30일 47%) 서버에서 주문과
 * 장바구니를 이어붙일 열쇠가 없다. 주문완료 페이지에서 같은 브라우저의 익명ID를
 * 들고 알려주는 게 유일한 연결고리다.
 *
 * ⚠️ 담기 없이 바로 산 사람도 이 호출을 한다 — 그 경우 닫을 게 없어 0건이 되는 게 정상이다.
 */
export async function markPurchased(
  mall: CrmMall,
  who: { memberId?: string | null; anonId?: string | null },
  orderId?: string | null,
): Promise<number> {
  const db = crmDb();
  const idCol = who.memberId ? "member_id" : "anon_id";
  const idVal = who.memberId || who.anonId;
  if (!idVal) return 0;
  const { data } = await db
    .from("crm_cart_events")
    .update({ status: "converted", converted_at: new Date().toISOString(), order_id: orderId ?? null })
    .eq("mall", mall)
    .eq(idCol, idVal)
    .eq("status", "active")
    .select("id");
  return data?.length ?? 0;
}
