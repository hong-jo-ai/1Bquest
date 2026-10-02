/**
 * 카페24 고객 취소·교환·반품 "신청" → Telegram 알림.
 *
 * 왜 필요한가: 2026-10-03 두 국문몰의 고객 클레임 신청 기능(orders/setting claim_request)을 켰다.
 * 그 전엔 꺼져 있어 고객이 주문 화면에서 취소할 방법이 없었고, 웹챗으로 "취소 버튼이 없다"는 문의가 이어졌다.
 * 켜고 나면 새 위험이 생긴다 — 출고 수집(buildPostOffice.js)은 status_text 가 "배송준비중"인 품목만 집으므로
 * 고객이 취소신청을 건 주문은 **조용히 출고에서 빠진다**. 자동 승인은 꺼 두었으니(claim_request_auto_accept F)
 * 누군가 보고 승인·거부하지 않으면 출고도 환불도 안 된 채 방치된다. 그래서 신청이 들어오는 즉시 알린다.
 *
 * 각인 주문은 새긴 뒤 취소신청이 들어올 수 있다 — 알림에 각인 여부를 같이 적어 판단하게 한다.
 */
import { fetchAllOrders } from "./cafe24Data";
import { getAccessTokenFromStore } from "./cafe24TokenStore";
import type { MallId } from "./cafe24Client";
import { sendTelegramMessage } from "./cs/telegram";
import { getCsSupabase } from "./cs/store";

const KV_KEY = "cafe24_claim_alerted:v1"; // { "<mall>|<order_item_code>|<status>": alertedAt }
const LOOKBACK_DAYS = 21; // 반품·교환 신청은 배송완료 후 7일까지 열려 있다 — 주문일 기준으로 넉넉히 본다
const MALLS: { mall: MallId; label: string }[] = [
  { mall: "paulvice", label: "폴바이스" },
  { mall: "harriot", label: "해리엇" },
];

interface Item {
  order_item_code?: string;
  product_name?: string;
  option_value?: string;
  quantity?: number | string;
  order_status?: string;
  status_text?: string;
  claim_reason?: string;
  additional_option_value?: string;
}
interface Order {
  order_id?: string;
  order_place_name?: string;
  billing_name?: string;
  buyer_name?: string;
  items?: Item[];
}

/** 고객이 건 "신청" 단계만. 관리자 접수(C10·R10·E10) 이후는 이미 누군가 처리 중이다. */
function isRequested(it: Item): boolean {
  return /^(C00|R00|E00)$/.test(String(it.order_status ?? "")) || /신청$/.test(String(it.status_text ?? ""));
}

function kstDate(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function format(label: string, o: Order, it: Item): string {
  const kind = String(it.status_text ?? it.order_status ?? "신청");
  const engraving = String(it.additional_option_value ?? "").split("=").slice(1).join("=").trim();
  const name = it.option_value ? `${it.product_name} (${it.option_value})` : String(it.product_name ?? "?");
  const lines = [
    `🙋 <b>고객 ${esc(kind)} — ${esc(label)}</b>${o.order_place_name ? ` · ${esc(o.order_place_name)}` : ""}`,
    `${esc(o.billing_name || o.buyer_name || "?")} · ${esc(name)}`,
    `주문번호 <code>${esc(o.order_id ?? "?")}</code>`,
    it.claim_reason ? `사유: ${esc(it.claim_reason)}` : "",
    engraving ? `⚠️ 각인 주문: ${esc(engraving.slice(0, 60))} — 이미 새겼는지 확인` : "",
    kind.includes("취소") ? "이 주문은 출고 수집에서 빠집니다. 카페24 관리자에서 승인/거부해 주세요." : "카페24 관리자에서 승인/거부해 주세요.",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function watchCafe24Claims(): Promise<{ checked: number; requested: number; sent: number; seeded?: boolean; errors: string[] }> {
  const db = getCsSupabase();
  const { data } = await db.from("kv_store").select("data").eq("key", KV_KEY).maybeSingle();
  const firstRun = !data?.data;
  const alerted: Record<string, string> = (data?.data as Record<string, string>) ?? {};
  const errors: string[] = [];
  let checked = 0, requested = 0, sent = 0;

  for (const { mall, label } of MALLS) {
    const token = await getAccessTokenFromStore(mall);
    if (!token) { errors.push(`${label} 토큰 없음`); continue; }
    let orders: Order[] = [];
    try {
      orders = (await fetchAllOrders(token, kstDate(-LOOKBACK_DAYS), kstDate(0), true, mall)) as Order[];
    } catch (e) {
      errors.push(`${label} 주문 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    checked += orders.length;
    for (const o of orders) {
      for (const it of o.items ?? []) {
        if (!isRequested(it)) continue;
        requested++;
        const key = `${mall}|${it.order_item_code ?? o.order_id}|${it.order_status}`;
        if (alerted[key]) continue;
        // 첫 실행은 기존 신청을 알리지 않고 기록만 한다(켜기 전부터 쌓인 마켓 반품신청 등으로 한꺼번에 울리지 않게).
        if (!firstRun) {
          if (await sendTelegramMessage(format(label, o, it))) sent++;
          else continue; // 전송 실패분은 다음 회차에 다시 시도
        }
        alerted[key] = new Date().toISOString();
      }
    }
  }

  await db.from("kv_store").upsert({ key: KV_KEY, data: alerted, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return { checked, requested, sent, ...(firstRun ? { seeded: true } : {}), errors };
}
