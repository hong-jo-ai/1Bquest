/**
 * 상품페이지 "리뷰 작성하기" → 우리 리뷰 페이지 진입 (2026-09-15).
 *
 * 왜: 카페24 후기 게시판 작성 폼은 사진 첨부가 없고 캡차까지 걸려 있다(김동훈 고객 사고).
 * 알림톡 링크로 들어오는 리뷰 페이지는 사진·동영상·적립금까지 다 되는데, 그 링크에는
 * "누가 어떤 주문으로" 가 토큰에 박혀 있다. 상품페이지에서 들어오면 그게 없으므로
 * 여기서 **연락처 하나(국내=휴대폰, 영문몰=이메일)로 카페24 주문을 찾아** 같은 토큰을 만든다.
 *
 * 사장님 결정: 구매 확인이 안 되면 **적립금 없이 작성은 허용**(스팸이면 사후 숨김).
 * 이름만으로는 안 찾는다(동명이인) — 연락처가 곧 본인확인이다.
 */
import { cafe24Get } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { getMall, signReviewToken, type MallConfig, type MallId } from "./core";

export interface PurchaseMatch {
  orderRef: string;
  name?: string;
  phone?: string;
  email?: string;
  productName?: string;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 카페24 주문 조회는 **한 번에 6개월까지**(422). 1년을 두 창으로 나눠 본다. */
const WINDOW_DAYS = 180;
const LOOKBACK_WINDOWS = 2;

/**
 * 연락처로 이 상품을 산 주문을 찾는다. 취소/반품(C·R)만 걸러내고 결제된 주문은 배송 단계와 무관하게 인정한다
 * — 받자마자 쓰고 싶은 고객을 막을 이유가 없다. 여러 건이면 가장 최근 주문.
 */
export async function findPurchase(
  mall: MallConfig,
  contact: { phone?: string; email?: string },
  productNo: number,
): Promise<PurchaseMatch | null> {
  const phone = (contact.phone ?? "").replace(/\D/g, "");
  const email = (contact.email ?? "").trim().toLowerCase();
  if (phone.length < 10 && !email) return null;

  const at = await getAccessTokenFromStore(mall.cafe24Mall);
  if (!at) return null;

  let end = new Date();
  for (let w = 0; w < LOOKBACK_WINDOWS; w++) {
    const start = new Date(end.getTime() - WINDOW_DAYS * 86400_000);
    const qs = new URLSearchParams({
      shop_no: String(mall.shopNo),
      start_date: ymd(start), end_date: ymd(end),
      date_type: "pay_date",
      embed: "items,buyer",
      limit: "100",
    });
    // 실측(2026-09-15): buyer_cellphone 은 하이픈 유무 모두 매칭, buyer_email 도 동작. buyer_phone/member_email 은 0건.
    if (phone.length >= 10) qs.set("buyer_cellphone", phone);
    else qs.set("buyer_email", email);

    let data: { orders?: Array<Record<string, unknown>> } | null = null;
    try {
      data = await cafe24Get(`/api/v2/admin/orders?${qs}`, at, mall.cafe24Mall);
    } catch {
      data = null;
    }
    const orders = (data?.orders ?? []) as Array<{
      order_id?: string;
      buyer?: { name?: string; cellphone?: string; email?: string };
      items?: Array<{ product_no?: number | string; product_name?: string; order_status?: string }>;
    }>;
    // 최근 결제순으로 오지 않을 수 있으니 order_id(날짜 접두)로 내림차순
    orders.sort((a, b) => String(b.order_id ?? "").localeCompare(String(a.order_id ?? "")));
    for (const o of orders) {
      const hit = (o.items ?? []).find((it) => {
        if (Number(it.product_no) !== Number(productNo)) return false;
        const s = String(it.order_status ?? "").toUpperCase();
        return !/^[CR]/.test(s); // C=취소, R=반품 계열은 구매로 안 본다
      });
      if (!hit || !o.order_id) continue;
      return {
        orderRef: String(o.order_id),
        name: o.buyer?.name || undefined,
        phone: o.buyer?.cellphone || (phone || undefined),
        email: o.buyer?.email || (email || undefined),
        productName: hit.product_name || undefined,
      };
    }
    end = start;
  }
  return null;
}

/** 상품명(몰 언어 기준). 실패하면 번호로 대체 — 이름을 못 가져왔다고 작성까지 막지 않는다. */
export async function productNameFor(mall: MallConfig, productNo: number): Promise<string> {
  try {
    const at = await getAccessTokenFromStore(mall.cafe24Mall);
    if (!at) return `#${productNo}`;
    const res = (await cafe24Get(
      `/api/v2/admin/products/${productNo}?shop_no=${mall.shopNo}`, at, mall.cafe24Mall,
    )) as { product?: { product_name?: string } };
    return res?.product?.product_name?.trim() || `#${productNo}`;
  } catch {
    return `#${productNo}`;
  }
}

/** 화면에 미리 채울 이름은 가린다 — 연락처를 아는 사람이 실명을 확인하는 경로가 되면 안 된다. */
export function maskName(name?: string): string {
  const n = (name ?? "").trim();
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0] + "*";
  return n[0] + "*".repeat(n.length - 2) + n[n.length - 1];
}

export interface EntryResult {
  token: string;
  verified: boolean;
  productName: string;
}

/**
 * 상품페이지 진입용 토큰 발급. 주문을 찾으면 알림톡 링크와 **완전히 같은 토큰**(orderRef 포함)이라
 * 적립금·구매확인·중복방지가 그대로 동작한다. 못 찾으면 verified:false — 작성은 되지만 적립금 0.
 */
export async function issueEntryToken(
  mallId: MallId,
  productNo: number,
  contact: { phone?: string; email?: string },
): Promise<EntryResult | null> {
  const mall = getMall(mallId);
  if (!mall || !Number.isFinite(productNo) || productNo <= 0) return null;

  const match = await findPurchase(mall, contact, productNo);
  const productName = match?.productName || (await productNameFor(mall, productNo));
  const phone = (contact.phone ?? "").replace(/\D/g, "");
  const email = (contact.email ?? "").trim().toLowerCase();

  if (match) {
    const token = signReviewToken({
      mall: mall.id, productNo, productName,
      orderRef: match.orderRef,
      name: maskName(match.name),
      phone: match.phone, email: match.email,
      verified: true,
      // 상품페이지 진입은 링크가 돌아다니지 않으니 짧게(하루)
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });
    return { token, verified: true, productName };
  }
  const token = signReviewToken({
    mall: mall.id, productNo, productName,
    phone: phone.length >= 10 ? phone : undefined,
    email: email || undefined,
    verified: false,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  });
  return { token, verified: false, productName };
}
