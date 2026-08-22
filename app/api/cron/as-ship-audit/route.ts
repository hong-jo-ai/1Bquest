/**
 * AS 발송 점검 — "보냈다고 표시됐지만 실제로 안 나간 건"을 잡는다.
 *
 * 배경(2026-08-20 김영아 건): AS 3건을 한꺼번에 status='shipped' 로 바꿨는데
 * 그중 실제 발송이 필요한 1건이 송장 없이 표시만 바뀐 채 23일간 묻혔다.
 * `shipped` 는 자동 발송이 아니라 표시일 뿐이라, 송장이 없으면 아무도 모른다.
 * 사장님이 우연히 눈치채서 발견했다 — 다음엔 못 잡는다.
 *
 * 점검 3종:
 *  A. 송장 없이 shipped   — 수리/교환 건인데 return_tracking_no 가 비었다 (환불 건은 발송이 없으므로 제외)
 *  B. 송장은 있는데 미집하 — 접수만 되고 종추적 스캔이 하루 넘게 안 찍혔다(라벨만 뽑고 안 실었을 때)
 *  C. 장기 정체          — 접수 후 오래 지나도 아직 발송 전 상태
 *
 * 알림 피로 방지: 직전 발송과 대상 집합이 같으면 스킵(월요일엔 무조건 1회 발송).
 *
 * GET + Authorization: Bearer ${CRON_SECRET} (cron) / POST (수동, 항상 발송)
 */
import { createClient } from "@supabase/supabase-js";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { withCron, manualRun } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATE_KEY = "as_ship_audit:state";
const UNSCANNED_HOURS = 24; // 접수 후 이 시간 넘게 스캔 없으면 미집하 의심
const STALE_DAYS = 10;      // 접수 후 이 일수 넘게 발송 전이면 정체
/**
 * 점검 창. 이보다 오래된 건은 본문에서 빼고 건수만 표기한다.
 * 과거 기록에는 (a) 송장을 기록 안 하고 보낸 건, (b) 종추적 크론 도입(2026-08-05) 전이라
 * tracking_state 가 영영 비어 있는 건이 섞여 있어 그대로 올리면 13건이 매일 뜬다 → 곧 안 보게 된다.
 */
const WINDOW_DAYS = 30;

/** 발송 실물이 나가야 하는 유형. 환불은 고객에게 보낼 물건이 없다. */
const SHIPPING_TYPES = ["repair", "exchange"];

interface AsRow {
  id: string;
  as_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  model: string | null;
  request_type: string | null;
  status: string;
  return_tracking_no: string | null;
  shipped_at: string | null;
  created_at: string;
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3);
const hoursSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3);

function label(r: AsRow): string {
  const who = [r.customer_name, r.customer_phone].filter(Boolean).join(" ");
  const what = (r.model || "").slice(0, 28) || "품목미상";
  return `${r.as_number} · ${who || "고객미상"} · ${what}`;
}

async function run(force = false): Promise<Response> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");

  // 발송 전/후 판단에 필요한 건만. 완료·환불로 닫힌 건은 제외하지 않고 유형으로 거른다.
  const { data, error } = await db
    .from("as_requests")
    .select("id, as_number, customer_name, customer_phone, model, request_type, status, return_tracking_no, shipped_at, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`as_requests 조회 실패: ${error.message}`);

  const all = (data ?? []) as AsRow[];
  const shipType = (r: AsRow) => SHIPPING_TYPES.includes(r.request_type ?? "repair");
  /** 판단 기준 시각 — 발송 표시가 있으면 그 때, 없으면 접수일. */
  const refAt = (r: AsRow) => r.shipped_at || r.created_at;
  const inWindow = (r: AsRow) => daysSince(refAt(r)) <= WINDOW_DAYS;

  // 창 밖(과거 이월분)은 본문에서 빼고 건수만 센다.
  const rows = all.filter(inWindow);
  const carriedOver = all.filter(
    (r) => !inWindow(r) && shipType(r) &&
      ((r.status === "shipped" && !String(r.return_tracking_no || "").trim()) ||
       (r.status !== "shipped" && daysSince(r.created_at) >= STALE_DAYS)),
  ).length;

  // A. 송장 없이 shipped
  const noTracking = rows.filter(
    (r) => r.status === "shipped" && shipType(r) && !String(r.return_tracking_no || "").trim(),
  );

  // B. 송장은 있는데 종추적 스캔이 없다 → 라벨만 뽑고 집하에 안 실었을 가능성
  const tracked = rows.filter(
    (r) => r.status === "shipped" && shipType(r) && String(r.return_tracking_no || "").trim(),
  );
  const unscanned: Array<AsRow & { hours: number }> = [];
  if (tracked.length) {
    const { data: ships } = await db
      .from("pp_shipments")
      .select("regi_no, tracking_state, registered_at")
      .in("regi_no", tracked.map((r) => String(r.return_tracking_no)));
    const byNo = new Map((ships ?? []).map((s) => [String(s.regi_no), s]));
    for (const r of tracked) {
      const s = byNo.get(String(r.return_tracking_no));
      const since = r.shipped_at || r.created_at;
      // 접수 기록 자체가 없거나(수기 송장) 스캔이 안 찍힌 채 시간이 지났으면 의심
      if ((!s || !s.tracking_state) && hoursSince(since) >= UNSCANNED_HOURS) {
        unscanned.push({ ...r, hours: hoursSince(since) });
      }
    }
  }

  // C. 장기 정체 — 아직 발송 전인데 오래 묵음
  const stale = rows
    .filter((r) => shipType(r) && r.status !== "shipped" && daysSince(r.created_at) >= STALE_DAYS)
    .map((r) => ({ ...r, days: daysSince(r.created_at) }));

  const total = noTracking.length + unscanned.length + stale.length;

  // 변동분만 발송 (월요일은 전체 1회)
  const sig = JSON.stringify({
    a: noTracking.map((r) => r.as_number).sort(),
    b: unscanned.map((r) => r.as_number).sort(),
    c: stale.map((r) => r.as_number).sort(),
  });
  const { data: st } = await db.from("kv_store").select("data").eq("key", STATE_KEY).maybeSingle();
  const prev = (st?.data ?? {}) as { sig?: string; lastFull?: string };
  const today = kstNow().toISOString().slice(0, 10);
  const weeklyDue = kstNow().getUTCDay() === 1 && prev.lastFull !== today;

  if (total === 0) {
    await db.from("kv_store").upsert(
      { key: STATE_KEY, data: { sig, lastFull: weeklyDue ? today : prev.lastFull }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    return Response.json({ ok: true, total: 0, sent: false });
  }
  if (!force && sig === prev.sig && !weeklyDue) {
    return Response.json({ ok: true, total, sent: false, reason: "변동 없음" });
  }

  const msg = [
    `🔍 <b>AS 발송 점검</b> — 확인 필요 ${total}건`,
    ...(noTracking.length
      ? ["", `<b>🔴 송장 없이 '발송완료' (${noTracking.length})</b>`,
         `표시만 바뀌고 실제로 안 나갔을 수 있습니다.`,
         ...noTracking.map((r) => `· ${label(r)}`)]
      : []),
    ...(unscanned.length
      ? ["", `<b>🟠 송장은 있는데 집하 안 됨 (${unscanned.length})</b>`,
         `라벨만 뽑고 안 실었을 수 있습니다.`,
         ...unscanned.map((r) => `· ${label(r)} — 송장 ${r.return_tracking_no} · ${r.hours}시간 경과`)]
      : []),
    ...(stale.length
      ? ["", `<b>🟡 장기 정체 — 아직 발송 전 (${stale.length})</b>`,
         ...stale.map((r) => `· ${label(r)} — 접수 ${r.days}일째 (${r.status})`)]
      : []),
    ...(carriedOver
      ? ["", `<i>※ ${WINDOW_DAYS}일 이전 이월분 ${carriedOver}건은 제외했습니다(과거 기록 미비 포함).</i>`]
      : []),
    "",
    `<i>클로드에게 "AS 발송 점검"이라고 하면 건별로 조치합니다.</i>`,
  ].join("\n");

  await sendTelegramMessage(msg);
  await db.from("kv_store").upsert(
    { key: STATE_KEY, data: { sig, lastFull: weeklyDue ? today : prev.lastFull }, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );

  return Response.json({
    ok: true, sent: true, total,
    noTracking: noTracking.length, unscanned: unscanned.length, stale: stale.length,
  });
}

export const GET = withCron("as-ship-audit", () => run());

// 수동 실행도 manualRun 으로 감싼다 — 하트비트를 남겨야 워치독 오탐이 자동 회복된다.
export async function POST() {
  return manualRun("as-ship-audit", () => run(true));
}
