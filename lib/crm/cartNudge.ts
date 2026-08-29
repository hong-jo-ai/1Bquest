/**
 * CRM 장바구니 이탈 넛지 — 감지 + 발송.
 * active 카트 이벤트 중 ①이후 해당상품 주문 있으면 converted 처리(넛지 중단)
 * ②미구매분은 경과시간 단계(1h/24h/72h)에 맞춰 1회씩 넛지(중복방지=crm_message_log).
 * 채널: 알림톡 설정 시 알림톡, 아니면 SMS(현재 SMS). 발송번호=회원 cellphone(read_customer).
 */
import { cafe24Get } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { sendMany } from "@/lib/sms/solapi";
import { crmDb, CRM_BRANDS, claimNudge, markCartStatus, type CrmMall, type CartEventRow } from "./cartStore";

const HOUR = 3600_000;
const EXPIRE_MS = 7 * 24 * HOUR;
// 내림차순(가장 진행된 단계 우선) — age가 넘긴 가장 높은 단계 1개만 현재 대상.
const STAGES = [
  { key: "72h", afterMs: 72 * HOUR },
  { key: "24h", afterMs: 24 * HOUR },
  { key: "1h",  afterMs: 1 * HOUR },
] as const;

function dueStage(ageMs: number): "1h" | "24h" | "72h" | null {
  for (const s of STAGES) if (ageMs >= s.afterMs) return s.key;
  return null;
}

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

/** 회원 정보(이름·휴대폰) 조회 — member_id 기준. */
async function lookupMember(mall: CrmMall, memberId: string, at: string): Promise<{ phone: string; name: string } | null> {
  const { shopNo, cafe24Mall } = CRM_BRANDS[mall];
  try {
    const res = await cafe24Get(
      `/api/v2/admin/customers?shop_no=${shopNo}&member_id=${encodeURIComponent(memberId)}&limit=1`,
      at,
      cafe24Mall,
    );
    const c = res?.customers?.[0];
    const phone = digits(c?.cellphone || c?.phone);
    if (phone.length < 10) return null;
    return { phone, name: (c?.name || "고객").toString() };
  } catch {
    return null;
  }
}

/** 회원의 cart_at 이후 주문 상품번호 목록(날짜 포함) — 전환 판정용. */
async function fetchMemberOrderedProducts(
  mall: CrmMall,
  memberId: string,
  sinceYmd: string,
  at: string,
): Promise<Array<{ date: string; productNos: number[] }>> {
  const { shopNo, cafe24Mall } = CRM_BRANDS[mall];
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await cafe24Get(
      `/api/v2/admin/orders?shop_no=${shopNo}&member_id=${encodeURIComponent(memberId)}&start_date=${sinceYmd}&end_date=${today}&date_type=order_date&embed=items&limit=100`,
      at,
      cafe24Mall,
    );
    const orders: Array<{ order_date?: string; created_date?: string; items?: Array<{ product_no?: number }> }> = res?.orders ?? [];
    return orders.map((o) => ({
      date: (o.order_date || o.created_date || "").toString(),
      productNos: (o.items ?? []).map((it) => Number(it.product_no)).filter((n) => !Number.isNaN(n)),
    }));
  } catch {
    return [];
  }
}

function buildNudgeSms(mall: CrmMall, name: string, productName: string | null, stage: "1h" | "24h" | "72h"): string {
  const { label, storeUrl } = CRM_BRANDS[mall];
  const product = productName || "담아두신 상품";
  const cart = `${storeUrl}/order/basket.html`;
  if (stage === "1h")
    return `[${label}] ${name}님, 장바구니에 담아두신 ${product} 아직 그대로 있어요.\n품절 전에 확인해 보세요 :)\n${cart}`;
  if (stage === "24h")
    return `[${label}] ${name}님, ${product} 아직 고민 중이신가요?\n인기 상품이라 재고가 빠르게 줄어요. 지금 마음 정하시면 좋아요.\n${cart}`;
  return `[${label}] ${name}님, ${product} 후기가 좋아요 — 많은 분들이 만족하셨어요.\n마지막으로 한 번 더 보여드릴게요.\n${cart}`;
}

export interface CartNudgeResult {
  mall: CrmMall;
  scanned: number;
  converted: number;
  sent: number;
  skipped: number;
  expired: number;
  failed: number;
}

/** 한 몰의 장바구니 이탈 넛지 1회 실행. dryRun=true 면 발송 없이 카운트만. */
export async function runCartNudge(mall: CrmMall, opts: { dryRun?: boolean } = {}): Promise<CartNudgeResult> {
  const db = crmDb();
  const at = await getAccessTokenFromStore(CRM_BRANDS[mall].cafe24Mall);
  if (!at) throw new Error(`${mall} 카페24 토큰 없음`);

  const since = new Date(Date.now() - EXPIRE_MS).toISOString();
  const { data: rows } = await db
    .from("crm_cart_events")
    .select("id,mall,shop_no,member_id,product_no,product_name,quantity,cart_at,converted_at,status")
    .eq("mall", mall)
    .eq("status", "active")
    .gte("cart_at", since)
    .order("cart_at", { ascending: true });
  const events = (rows ?? []) as CartEventRow[];

  const res: CartNudgeResult = { mall, scanned: events.length, converted: 0, sent: 0, skipped: 0, expired: 0, failed: 0 };

  // 회원별 그룹. 비로그인(anon_id) 담기는 넛지 대상이 아니다 —
  // 연락처를 모르니 보낼 수단이 없다. 관측용으로만 쌓인다.
  const byMember = new Map<string, CartEventRow[]>();
  for (const e of events) {
    if (!e.member_id) continue;
    const arr = byMember.get(e.member_id) ?? [];
    arr.push(e);
    byMember.set(e.member_id, arr);
  }

  const now = Date.now();
  const memberInfo = new Map<string, { phone: string; name: string } | null>();

  for (const [memberId, list] of byMember) {
    // 전환 판정: 가장 이른 cart_at 이후 주문 조회 1회
    const earliest = list.reduce((m, e) => (e.cart_at < m ? e.cart_at : m), list[0].cart_at);
    const sinceYmd = earliest.slice(0, 10);
    const orders = await fetchMemberOrderedProducts(mall, memberId, sinceYmd, at);

    for (const e of list) {
      const ageMs = now - new Date(e.cart_at).getTime();
      if (ageMs >= EXPIRE_MS) {
        if (!opts.dryRun) await markCartStatus(e.id, "expired");
        res.expired++;
        continue;
      }
      // 전환: cart_at 이후 주문에 해당 상품(product_no) 포함 → converted. product_no 없으면 cart_at 이후 아무 주문이나.
      const converted = orders.some(
        (o) => o.date >= e.cart_at && (e.product_no == null || o.productNos.includes(e.product_no)),
      );
      if (converted) {
        if (!opts.dryRun) await markCartStatus(e.id, "converted");
        res.converted++;
        continue;
      }
      const stage = dueStage(ageMs);
      if (!stage) { res.skipped++; continue; }

      // 회원 연락처 조회(캐시)
      if (!memberInfo.has(memberId)) memberInfo.set(memberId, await lookupMember(mall, memberId, at));
      const info = memberInfo.get(memberId);
      if (!info) { res.skipped++; continue; } // 연락처 없음 → 넛지 불가

      if (opts.dryRun) { res.sent++; continue; }

      // 단계 멱등 선점
      const claimed = await claimNudge(e.id, stage, { mall, memberId, phone: info.phone, channel: "sms" });
      if (!claimed) { res.skipped++; continue; }

      const text = buildNudgeSms(mall, info.name, e.product_name, stage);
      try {
        const out = await sendMany([{ to: info.phone, text, subject: `${CRM_BRANDS[mall].label} 장바구니 안내` }]);
        if (out.ok && out.successCount > 0) {
          res.sent++;
          if (stage === "72h") await markCartStatus(e.id, "done");
        } else {
          res.failed++;
          await db.from("crm_message_log").update({ status: "failed", detail: out.error ?? "send_fail" })
            .eq("pattern", "cart_abandon").eq("ref_id", e.id).eq("stage", stage);
        }
      } catch (err) {
        res.failed++;
        await db.from("crm_message_log").update({ status: "failed", detail: err instanceof Error ? err.message : String(err) })
          .eq("pattern", "cart_abandon").eq("ref_id", e.id).eq("stage", stage);
      }
    }
  }
  return res;
}
