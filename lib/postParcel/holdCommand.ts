/**
 * 텔레그램 발송보류/발송/발송취소 명령 — 발급된 송장 중 실제 발송 안 한 건을
 * 송장입력(발송중 처리)에서 제외/복귀/취소.
 *
 * 모든 채널 dispatch(송장입력)는 pp_shipments.status='submitted'만 처리하므로,
 * status를 'held'로 두면 자동 제외된다. (우체국 송장 자체는 유효 — 취소 안 함)
 *
 *  "이영희 발송보류" → status submitted→held (송장입력 제외, 송장 유효)
 *  "이영희 발송"     → status held→submitted (다음 송장입력에 발송중 처리)
 *  "이영희 발송취소" → 우체국 송장 취소(큐→아이맥 cancelShipment) + status held(즉시 제외)
 */
import { createClient } from "@supabase/supabase-js";
import { enqueueJob } from "./queue";

export type HoldAction = "hold" | "unhold" | "cancel";
export interface HoldCommand {
  name: string;
  action: HoldAction;
}

/** "<고객명> 발송보류|발송취소|발송완료|발송" 파싱. 아니면 null. */
export function parseHoldCommand(text: string): HoldCommand | null {
  const t = String(text || "").trim();
  const m = t.match(/^(.+?)\s*발송\s*(보류|취소|완료)?\s*(?:해\s*줘|처리)?[.!]?$/);
  if (!m) return null;
  const name = m[1].trim().replace(/(님|씨)$/, "").trim();
  if (name.length < 2 || name.length > 20) return null;
  if (/동기화|발주|급여|주차|출근|클로드|코드|면세|택배|반품|^cc\b/i.test(name)) return null;
  const sub = m[2];
  const action: HoldAction = sub === "보류" ? "hold" : sub === "취소" ? "cancel" : "unhold";
  return { name, action };
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

interface ShipRow {
  id: string; order_number: string; channel: string; req_type: string;
  recipient_name: string | null; regi_no: string | null; status: string; created_at: string;
}

// 최근 3일 내 해당 이름 + 상태 매칭 (옛 발송건 오작동 방지)
async function findShipments(name: string, statuses: string[]): Promise<ShipRow[]> {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data } = await db()
    .from("pp_shipments")
    .select("id,order_number,channel,req_type,recipient_name,regi_no,status,created_at")
    .ilike("recipient_name", `%${name}%`)
    .in("status", statuses)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  return (data ?? []) as ShipRow[];
}

const listOf = (rows: ShipRow[]) =>
  rows.map((r) => `· ${r.recipient_name || "?"} [${r.channel}] ${r.order_number} 송장 ${r.regi_no || "-"}`).join("\n");

/** 명령 실행 → 텔레그램 회신 메시지. */
export async function applyHoldCommand(cmd: HoldCommand): Promise<string> {
  const now = new Date().toISOString();

  if (cmd.action === "hold") {
    const rows = await findShipments(cmd.name, ["submitted"]);
    if (!rows.length) return `⚠️ ${cmd.name}: 보류할 '발송대기' 송장이 없습니다 (이미 발송처리됐거나 최근 발송건 없음).`;
    await db().from("pp_shipments").update({ status: "held", updated_at: now }).in("id", rows.map((r) => r.id));
    return `🔒 ${cmd.name} ${rows.length}건 **발송보류** — 송장입력(발송중)에서 제외됩니다. 송장은 그대로 유효해요.\n실제 보내면 "${cmd.name} 발송", 아예 무르려면 "${cmd.name} 발송취소".\n${listOf(rows)}`;
  }

  if (cmd.action === "unhold") {
    const rows = await findShipments(cmd.name, ["held"]);
    if (!rows.length) return `⚠️ ${cmd.name}: 보류 중인 송장이 없습니다.`;
    await db().from("pp_shipments").update({ status: "submitted", updated_at: now }).in("id", rows.map((r) => r.id));
    return `📦 ${cmd.name} ${rows.length}건 보류 해제 — 다음 송장입력(17시) 또는 채널 동기화 시 발송중 처리됩니다.\n${listOf(rows)}`;
  }

  // cancel — 즉시 held로 빼두고(중복 발송중 방지) 우체국 취소 큐 적재
  const rows = await findShipments(cmd.name, ["submitted", "held"]);
  if (!rows.length) return `⚠️ ${cmd.name}: 취소할 송장이 없습니다.`;
  await db().from("pp_shipments").update({ status: "held", updated_at: now }).in("id", rows.map((r) => r.id));
  for (const r of rows) {
    await enqueueJob("cancel", { order_number: r.order_number, channel: r.channel, req_type: r.req_type });
  }
  return `🗑 ${cmd.name} ${rows.length}건 **발송취소** 요청 — 우체국 송장 취소 중(아이맥 처리). 재고 들어오면 "${cmd.name} 택배예약"으로 재발급하세요.\n${listOf(rows)}`;
}
