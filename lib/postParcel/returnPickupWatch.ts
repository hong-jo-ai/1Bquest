/**
 * 회수(반품) 접수가 조용히 실패하는 걸 잡는 감시.
 *
 * 배경(2026-09-08): 8/20 신세계면세점 GWP 회수가 접수 다음 날 **신청취소**로 끝났는데
 *   아무도 몰랐다. 3주 뒤 사장님이 "저번 건 회수됐어?" 하고 물어서야 발견했다.
 *   출고(reqType 1)는 안 오면 고객이 연락하지만, **회수는 아무도 항의하지 않는다** —
 *   그래서 실패해도 조용하다. 이 감시가 유일한 통로다.
 *
 * 두 가지를 본다:
 *   ① 종추적이 '신청취소' 로 끝난 건 — 집배원이 갔는데 물건을 못 받아온 것
 *   ② 접수 3일이 지나도록 '운송장출력' 에 머물거나 이력이 없는 건 — 방문 자체가 안 된 것
 *
 * 같은 건을 매번 떠들지 않도록 kv 에 알린 상태를 남긴다(상태가 바뀌면 다시 알린다).
 */
import { createClient } from "@supabase/supabase-js";
import { sendTelegramMessage } from "@/lib/cs/telegram";

const ALERT_KEY = "return_pickup_alerted";
/** 이 날짜가 지나도록 진척이 없으면 "안 걷힌 것"으로 본다. 주말 끼는 걸 감안해 3일. */
const STALE_DAYS = 3;

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

type Row = {
  order_number: string; regi_no: string; recipient_name: string | null;
  product_name: string | null; tracking_state: string | null; created_at: string;
};

/** 실패로 볼 상태면 사람이 읽을 사유를, 정상이면 null 을 준다. */
function failureOf(r: Row, now: number): string | null {
  const st = (r.tracking_state ?? "").trim();
  if (/취소/.test(st)) return `종추적 "${st}" — 집배원이 물건을 못 받아왔습니다`;

  const days = Math.floor((now - new Date(r.created_at).getTime()) / 86400000);
  if (days >= STALE_DAYS && (!st || /운송장출력|접수/.test(st))) {
    return `접수 ${days}일째 ${st ? `"${st}"` : "이력 없음"} — 아직 안 걷혔습니다`;
  }
  return null;
}

export async function checkReturnPickups(): Promise<{ checked: number; alerted: number }> {
  const sb = db();
  // 접수 30일 안쪽의 회수 건만 — 그보다 오래된 건 이미 결론이 났다.
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data } = await sb
    .from("pp_shipments")
    .select("order_number, regi_no, recipient_name, product_name, tracking_state, created_at")
    .eq("req_type", "2")
    .gte("created_at", since);

  const rows = (data ?? []) as Row[];
  const { data: kv } = await sb.from("kv_store").select("data").eq("key", ALERT_KEY).maybeSingle();
  const seen = ((kv?.data as { states?: Record<string, string> } | undefined)?.states) ?? {};

  const now = Date.now();
  const fresh: string[] = [];
  for (const r of rows) {
    const why = failureOf(r, now);
    if (!why) continue;
    // 같은 상태로 이미 알렸으면 넘어간다. 상태가 달라졌으면 다시 알린다.
    if (seen[r.regi_no] === why) continue;
    seen[r.regi_no] = why;
    fresh.push(
      `• <b>${r.recipient_name ?? "?"}</b> ${r.product_name ?? ""}\n` +
        `  ${r.order_number} · 송장 ${r.regi_no}\n  ${why}`,
    );
  }

  if (fresh.length) {
    await sendTelegramMessage(
      `🔁 <b>회수 안 된 건 ${fresh.length}건</b>\n\n${fresh.join("\n\n")}\n\n` +
        `회수지에 연락해 물건을 준비시키거나 재접수가 필요합니다.`,
    ).catch(() => {});
    await sb.from("kv_store").upsert(
      { key: ALERT_KEY, data: { states: seen }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  }
  return { checked: rows.length, alerted: fresh.length };
}
