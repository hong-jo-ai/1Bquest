/**
 * 예약상품 미발송 감시 — 매일.
 *
 * 사고: `[8/19 재입고 예약]` 처럼 예약이 걸린 품목이 다른 품목과 함께 주문되면,
 *   출고 가드가 예약분만 보류하는데 **카페24는 그 송장으로 주문 전체를 '배송완료'로**
 *   넘겨버린다. 그 순간 미출고 목록에서 사라지고, 재입고가 되어도 아무도 다시 챙기지 않는다.
 *   2026-09-07 기준 4건 발생(장혜정·이경화·이지은·강희년). 셋은 고객이 화가 나서 연락해서야
 *   발견됐고, 이지은 님은 42일, 강희년 님은 28일 방치됐다.
 *
 * 판정: 예약 표기가 붙은 품목이 있는 주문에서, 그 주문의 우체국 접수기록 품목명에
 *   해당 상품명이 없으면 미발송으로 본다.
 *   (buildPostOffice.mergeByRecipient 가 한 소포의 품목을 " / " 로 전부 이어붙이므로,
 *    같이 나갔다면 접수 품목명에 반드시 이름이 들어 있다.)
 *
 * ⚠️ 카페24 주문조회는 기간이 길면 **에러 없이 빈 배열**을 돌려준다 → 30일씩 끊어 조회한다.
 */
import { withCron } from "@/lib/cron/withCron";
import { cafe24Get, type MallId } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PREORDER = /\[[^\]]*(예약|재입고|입고예정|출고예정)[^\]]*\]/;
/** 취소·환불·반품 품목은 발송 대상이 아니다. */
const DEAD = /취소|환불|반품/;
const LOOKBACK_DAYS = 150;
const ALERTED_KEY = "preorder_unshipped_alerted";
/**
 * 오탐 제외 목록 — `"<주문번호>|<정규화 상품명>"` 배열.
 *
 * ⚠️ 이 크론은 **접수 기록**만 보고 판정한다. 그런데 예약 품목이 접수 행에서 빠졌어도
 *    포장할 때 재고가 있어 **함께 넣어 보낸 경우**가 있고, 그건 시스템에 아무 흔적이 없다.
 *    2026-09-07 염경희 20260802-0000021 이 그랬다 — 미발송으로 잡아 사과 문자까지 보냈는데
 *    고객이 "받았다"고 전화하셨다. (원 소포 우체국 요금이 2,100원으로 다른 건 1,700원보다
 *    한 단계 비쌌던 게 단서였다 — 시계가 같이 들어 있었다는 뜻.)
 *
 * 그래서 이 목록은 **오탐을 영구히 잠재우는 장치**다. 여기 들어간 건은 다시 알리지 않는다.
 * → 이 크론의 결과는 "확정"이 아니라 **의심 목록**이다. 고객에게 사과부터 하지 말고
 *   반드시 실물·요금·고객 확인을 먼저 할 것.
 */
const IGNORE_KEY = "preorder_unshipped_ignore";

const MALLS: Array<{ mall: MallId; label: string }> = [
  { mall: "paulvice", label: "폴바이스" },
  { mall: "harriot", label: "해리엇" },
];

/** 상품명 비교용 정규화 — 브래킷 수식·기호·공백 제거. */
function core(s: string): string {
  return String(s ?? "").replace(/\[[^\]]*\]/g, "").replace(/[^가-힣A-Za-z0-9]/g, "").toLowerCase();
}

interface Suspect {
  label: string; order: string; date: string; name: string; phone: string; product: string; days: number;
}

function db() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE 환경변수 없음");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function run(): Promise<Response> {
  const sb = db();
  // ⚠️ Supabase select 는 기본 1000행에서 잘린다(에러 없이). pp_shipments 는 이미 1,300행이 넘어서
  //    그냥 읽으면 **최근 접수분이 통째로 빠지고**, 방금 재발송한 건까지 미발송으로 오탐한다.
  //    2026-09-07 첫 실행에서 실제로 그랬다 → 반드시 페이지네이션.
  const ships: Array<{ order_number: string; product_name: string; req_type: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("pp_shipments")
      .select("order_number,product_name,req_type").range(from, from + 999);
    if (error) throw new Error(`pp_shipments 조회 실패: ${error.message}`);
    ships.push(...(data ?? []) as typeof ships);
    if (!data || data.length < 1000) break;
  }
  // 재발송(-MS/-EX…)도 같은 주문으로 묶어 본다 — 이미 보냈으면 미발송이 아니다.
  const shipped = new Map<string, string>();
  for (const s of ships) {
    if (s.req_type === "2") continue;                       // 반품 회수는 제외
    const base = String(s.order_number ?? "").replace(/-(EX\d*|MS|RT|AS)$/i, "");
    shipped.set(base, (shipped.get(base) ?? "") + "|" + core(s.product_name));
  }

  const suspects: Suspect[] = [];
  const errors: string[] = [];
  const today = Date.now();

  for (const { mall, label } of MALLS) {
    const token = await getAccessTokenFromStore(mall);
    if (!token) { errors.push(`${label} 카페24 토큰 없음`); continue; }
    for (let w = 0; w < Math.ceil(LOOKBACK_DAYS / 30); w++) {
      const to = new Date(today - w * 30 * 86400000);
      const from = new Date(to.getTime() - 30 * 86400000 + 86400000);
      const path =
        `/api/v2/admin/orders?start_date=${from.toISOString().slice(0, 10)}` +
        `&end_date=${to.toISOString().slice(0, 10)}&date_type=order_date&limit=500&embed=items,receivers`;
      let orders: Array<Record<string, unknown>> = [];
      try {
        const res = (await cafe24Get(path, token, mall)) as { orders?: Array<Record<string, unknown>> };
        orders = res.orders ?? [];
      } catch (e) { errors.push(`${label} 조회 실패: ${e instanceof Error ? e.message : e}`); continue; }

      for (const o of orders) {
        const items = (o.items ?? []) as Array<Record<string, unknown>>;
        const orderId = String(o.order_id ?? "");
        const sentText = shipped.get(orderId) ?? "";
        for (const it of items) {
          const pname = String(it.product_name ?? "");
          if (!PREORDER.test(pname)) continue;
          const status = String(it.status_text ?? it.order_status ?? "");
          if (DEAD.test(status)) continue;
          if (sentText.includes(core(pname).slice(0, 10))) continue;   // 같이 나갔다
          const rc = ((o.receivers ?? []) as Array<Record<string, unknown>>)[0] ?? {};
          const d = String(o.order_date ?? "").slice(0, 10);
          suspects.push({
            label, order: orderId, date: d, product: pname,
            name: String(rc.name ?? ""), phone: String(rc.cellphone ?? rc.phone ?? ""),
            days: Math.floor((today - new Date(d + "T00:00:00+09:00").getTime()) / 86400000),
          });
        }
      }
    }
  }

  // 오탐으로 확인된 건은 통째로 뺀다(접수 기록엔 없지만 실제로는 나간 건).
  const { data: ig } = await sb.from("kv_store").select("data").eq("key", IGNORE_KEY).maybeSingle();
  const ignore = new Set<string>(((ig?.data as { orders?: string[] } | undefined)?.orders) ?? []);
  const kept = suspects.filter((s) => !ignore.has(`${s.order}|${core(s.product)}`));
  suspects.length = 0;
  suspects.push(...kept);

  // 이미 알린 건은 다시 떠들지 않는다 — 새로 생긴 것만 알린다.
  const { data: prev } = await sb.from("kv_store").select("data").eq("key", ALERTED_KEY).maybeSingle();
  const seen = new Set<string>(((prev?.data as { orders?: string[] } | undefined)?.orders) ?? []);
  const fresh = suspects.filter((s) => !seen.has(`${s.order}|${core(s.product)}`));

  if (fresh.length) {
    const line = (s: Suspect) =>
      `· <b>${s.name}</b> ${s.phone} — ${s.date}(${s.days}일 경과)\n  ${s.product}\n  주문 ${s.order}`;
    await sendTelegramMessage(
      `🚨 <b>예약상품 미발송 ${fresh.length}건</b>\n`
      + `예약이 걸린 품목이 함께 주문돼 카페24는 '배송완료'로 넘어갔는데 실제로는 안 나간 건입니다.\n\n`
      + fresh.map(line).join("\n\n")
      + (suspects.length > fresh.length ? `\n\n(이미 알린 건 ${suspects.length - fresh.length}건은 생략)` : ""),
    ).catch(() => {});
  }

  await sb.from("kv_store").upsert({
    key: ALERTED_KEY,
    data: { orders: suspects.map((s) => `${s.order}|${core(s.product)}`), checkedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });

  if (errors.length) throw new Error(errors.join(" / "));   // 조회 실패는 워치독이 잡게 한다
  return Response.json({ ok: true, suspects: suspects.length, fresh: fresh.length, list: fresh });
}

export const GET = withCron("preorder-unshipped", run);
