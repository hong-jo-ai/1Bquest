/**
 * CRM 장바구니 이탈 넛지 — 감지 + 발송.
 * active 카트 이벤트 중 ①이후 해당상품 주문 있으면 converted 처리(넛지 중단)
 * ②미구매분은 경과시간 단계(1h/24h/72h)에 맞춰 1회씩 넛지(중복방지=crm_message_log).
 *
 * **채널: 국내(shop_no=1)=문자 · 해외(shop_no=2)=이메일.** 해외는 국제문자가 실효성이 없고
 * 비용도 비싸다. 회원만 대상이다 — 담기의 85%는 비회원이라 연락처 자체가 없고,
 * 그쪽은 온사이트 리마인더(pv-hesitate.js)가 맡는다.
 *
 * **쿠폰은 붙이지 않는다(사장님 결정 2026-09-02).** 폴바이스 공홈은 이미 평균 17.7%
 * 상시할인 중이고, 해리엇은 조선몰이 "공홈보다 싸야 기사 송출" 조건을 걸어 가입쿠폰을
 * 10%→5%로 내린 상태다. 여기에 할인을 더 얹으면 그 조건이 깨진다. 담아둔 걸 알려주기만 한다.
 *
 * ⚠️ **광고성 정보 규제(정보통신망법).** 이건 거래 안내가 아니라 판촉이다. 그래서:
 *   ① 수신동의한 회원에게만 — 문자는 `sms`, 메일은 `news_mail` 동의 필드를 확인한다.
 *   ② 문자 본문에 `(광고)` 표기와 무료수신거부 번호. 번호가 설정 안 돼 있으면 **아예 안 보낸다.**
 *   ③ 문자는 21~08시(한국시간) 발송 금지. 이메일은 이 시간 제한에서 제외된다.
 *   ④ 메일에도 수신거부 방법을 본문에 명시한다.
 */
import { cafe24Get } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { sendMany } from "@/lib/sms/solapi";
// 대외 발신은 shong@harriotwatches.com 하나로 통일한다(사장님 지시 2026-07-09).
import { sendReviewRequest } from "@/lib/reviews/campaign";
import { crmDb, CRM_BRANDS, basketUrl, claimNudge, markCartStatus, type CrmMall, type CartEventRow } from "./cartStore";

const HOUR = 3600_000;
const EXPIRE_MS = 7 * 24 * HOUR;
// 내림차순(가장 진행된 단계 우선) — age가 넘긴 가장 높은 단계 1개만 현재 대상.
const STAGES = [
  { key: "72h", afterMs: 72 * HOUR },
  { key: "24h", afterMs: 24 * HOUR },
  { key: "1h",  afterMs: 1 * HOUR },
] as const;

type Stage = "1h" | "24h" | "72h";

function dueStage(ageMs: number): Stage | null {
  for (const s of STAGES) if (ageMs >= s.afterMs) return s.key;
  return null;
}

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

/** 무료수신거부 번호. 광고성 문자엔 법적 필수라, 없으면 문자를 보내지 않는다. */
function smsOptOut(): string | null {
  return process.env.CRM_SMS_OPTOUT || process.env.REVIEW_SMS_OPTOUT || null;
}

/** 한국시간 기준 시(hour) — 광고성 문자 야간(21~08시) 발송 차단 판정용. */
function seoulHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false })
      .format(new Date()),
  );
}

/** 지금 광고성 문자를 보내도 되는 시간인가. 이메일은 이 제한을 받지 않는다. */
function smsQuietHours(): boolean {
  const h = seoulHour();
  return h >= 21 || h < 8;
}

interface MemberContact {
  name: string;
  phone: string | null;
  email: string | null;
  /** 카페24 회원의 SMS 수신동의(`sms`). 광고성 문자는 이게 T 여야만 보낸다. */
  smsConsent: boolean;
  /** 이메일 수신동의(`news_mail`). */
  emailConsent: boolean;
}

/** 회원 연락처·수신동의 조회 — member_id 기준. */
async function lookupMember(
  mall: CrmMall,
  memberId: string,
  shopNo: number,
  at: string,
): Promise<MemberContact | null> {
  const { cafe24Mall } = CRM_BRANDS[mall];
  try {
    const res = await cafe24Get(
      `/api/v2/admin/customers?shop_no=${shopNo}&member_id=${encodeURIComponent(memberId)}&limit=1`,
      at,
      cafe24Mall,
    );
    const c = res?.customers?.[0];
    if (!c) return null;
    const phone = digits(c.cellphone || c.phone);
    const email = typeof c.email === "string" && c.email.includes("@") ? c.email.trim() : null;
    // 카페24는 동의 필드를 "T"/"F" 로 준다. 값이 없으면 **동의하지 않은 것으로 본다** —
    // 광고성 발송에서 모호함은 미동의 쪽으로 해석해야 안전하다.
    const yes = (v: unknown) => String(v ?? "").toUpperCase() === "T";
    return {
      name: (c.name || "고객").toString(),
      phone: phone.length >= 10 ? phone : null,
      email,
      smsConsent: yes(c.sms),
      emailConsent: yes(c.news_mail),
    };
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

/**
 * 국내 문자 본문. **(광고) 표기와 무료수신거부 안내는 여기서 붙인다** —
 * 호출부에서 빼먹을 수 있는 자리에 두면 언젠가 빠진다.
 * 할인 언급은 넣지 않는다(쿠폰 미제공).
 */
function buildNudgeSms(
  mall: CrmMall,
  name: string,
  productName: string | null,
  stage: Stage,
  cart: string,
  optOut: string,
): string {
  const { label } = CRM_BRANDS[mall];
  const product = productName || "담아두신 상품";
  const body =
    stage === "1h"
      ? `${name}님, 장바구니에 담아두신 ${product} 아직 그대로 있어요.`
      : stage === "24h"
        ? `${name}님, ${product} 아직 장바구니에 있어요. 품절 전에 확인해 보세요.`
        : `${name}님, 담아두신 ${product} 곧 장바구니에서 사라져요. 마지막으로 알려드려요.`;
  return [`(광고) [${label}]`, "", body, "", cart, "", `무료수신거부 ${optOut}`].join("\n");
}

/** 해외 회원 메일. 제목은 ASCII 만(비ASCII 는 헤더 인코딩이 필요하다). */
function buildNudgeEmail(
  mall: CrmMall,
  name: string,
  productName: string | null,
  stage: Stage,
  cart: string,
): { subject: string; html: string } {
  const brand = mall === "harriot" ? "Harriot" : "Paul Vice";
  const product = productName || "the piece you saved";
  const lead =
    stage === "1h"
      ? `${product} is still waiting in your bag.`
      : stage === "24h"
        ? `${product} is still in your bag. Pieces move quickly at this size of run.`
        : `This is the last note about ${product} in your bag.`;
  const subject = `Your ${brand} bag is still open`;
  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f6f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
    <tr><td style="padding:28px 26px 8px">
      <div style="font-size:12px;letter-spacing:.14em;color:#B1AAA2;text-transform:uppercase">${brand}</div>
      <p style="font-size:16px;color:#111;line-height:1.6;margin:14px 0 0">Hello ${name},</p>
      <p style="font-size:15px;color:#333;line-height:1.7;margin:10px 0 0">${lead}</p>
    </td></tr>
    <tr><td style="padding:20px 26px 28px">
      <a href="${cart}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;
        padding:13px 26px;border-radius:8px;font-size:14px">View your bag</a>
    </td></tr>
    <tr><td style="padding:14px 26px 22px;border-top:1px solid #eee;color:#999;font-size:11px;line-height:1.7">
      You are receiving this because you have an account at ${brand} and agreed to receive updates.
      Reply to this email with "unsubscribe" and we will remove you right away.
    </td></tr>
  </table>
</body></html>`;
  return { subject, html };
}

export interface CartNudgeResult {
  mall: CrmMall;
  scanned: number;
  converted: number;
  /** 실제 발송 — 채널별로 나눠 본다(해외 비중이 늘면 여기서 먼저 보인다). */
  sentSms: number;
  sentEmail: number;
  sent: number;
  skipped: number;
  /** 수신 미동의라 못 보낸 건. 이 숫자가 크면 넛지가 아니라 동의 확보가 과제다. */
  noConsent: number;
  /** 야간이라 미룬 건(문자만). 다음 실행에서 다시 대상이 된다. */
  quietHours: number;
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

  const res: CartNudgeResult = {
    mall, scanned: events.length, converted: 0,
    sentSms: 0, sentEmail: 0, sent: 0, skipped: 0, noConsent: 0, quietHours: 0, expired: 0, failed: 0,
  };
  const optOut = smsOptOut();
  const night = smsQuietHours();

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
  const memberInfo = new Map<string, MemberContact | null>();

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

      // 회원 연락처·수신동의 조회(캐시)
      if (!memberInfo.has(memberId)) memberInfo.set(memberId, await lookupMember(mall, memberId, e.shop_no, at));
      const info = memberInfo.get(memberId);
      if (!info) { res.skipped++; continue; }

      // 국내(shop_no=1)=문자 · 해외(shop_no=2)=이메일. 해외에 국제문자는 실효도 비용도 나쁘다.
      const channel: "sms" | "email" = e.shop_no === 2 ? "email" : "sms";

      if (channel === "sms") {
        // 광고성 문자의 3대 요건: 사전동의 · 무료수신거부 번호 · 야간 미발송.
        // 하나라도 못 갖추면 보내지 않는다. 과태료 대상이고, 스팸 신고는 브랜드에 남는다.
        if (!info.phone || !info.smsConsent) { res.noConsent++; continue; }
        if (!optOut) { res.skipped++; continue; }   // 수신거부 번호 미설정 → 발송 불가
        // 야간엔 선점(claim)도 하지 않는다. 선점만 해두고 못 보내면 그 단계는 영영 안 나간다.
        if (night) { res.quietHours++; continue; }
      } else {
        if (!info.email || !info.emailConsent) { res.noConsent++; continue; }
      }

      if (opts.dryRun) { res.sent++; continue; }

      // 단계 멱등 선점
      const claimed = await claimNudge(e.id, stage, {
        mall, memberId,
        phone: channel === "sms" ? info.phone! : info.email!,
        channel,
      });
      if (!claimed) { res.skipped++; continue; }

      const cart = basketUrl(mall, e.shop_no);
      try {
        let ok = false;
        let detail = "send_fail";
        if (channel === "sms") {
          const text = buildNudgeSms(mall, info.name, e.product_name, stage, cart, optOut!);
          const out = await sendMany([{ to: info.phone!, text, subject: `${CRM_BRANDS[mall].label} 장바구니 안내` }]);
          ok = out.ok && out.successCount > 0;
          detail = out.error ?? "send_fail";
          if (ok) res.sentSms++;
        } else {
          const { subject, html } = buildNudgeEmail(mall, info.name, e.product_name, stage, cart);
          await sendReviewRequest(info.email!, subject, html);
          ok = true;
          res.sentEmail++;
        }

        if (ok) {
          res.sent++;
          if (stage === "72h") await markCartStatus(e.id, "done");
        } else {
          res.failed++;
          await db.from("crm_message_log").update({ status: "failed", detail })
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
