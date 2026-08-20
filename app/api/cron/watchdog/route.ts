/**
 * 자동화 관제 워치독 — 시스템 감사(2026-07-02) 조치.
 *
 * "실행됐는데 실패"는 withCron/notifyFail이 알리지만, "아예 실행이 안 됨"(아이맥 꺼짐,
 * launchd 회차 소실, 크론 중단)은 아무도 몰랐다. 이 크론이 kv 하트비트의 신선도를 감시한다.
 *  - Vercel 크론: withCron 이 기록하는 `cron_last_ok:<name>`
 *  - 아이맥 launchd: local-agent/heartbeat.js 가 기록하는 `heartbeat:<job>`
 *
 * 30분마다 실행. 기한 초과(stale) 시 텔레그램 — 같은 잡은 6시간에 1번만(스팸 방지).
 * 아직 한 번도 하트비트가 없는 잡(미기록)은 최초 가동 후 48h 유예 뒤에만 경보.
 */
import { createClient } from "@supabase/supabase-js";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { withCron } from "@/lib/cron/withCron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface JobSpec { key: string; label: string; maxHours: number; weekdaysOnly?: boolean }

// ── 감시 대상 ─────────────────────────────────────────────
const JOBS: JobSpec[] = [
  // 아이맥 launchd (heartbeat:*)
  { key: "heartbeat:musinsa-sync", label: "무신사 동기화(iMac)", maxHours: 28, weekdaysOnly: true },
  { key: "heartbeat:wconcept-sync", label: "W컨셉 동기화(iMac)", maxHours: 28, weekdaysOnly: true },
  { key: "heartbeat:cm29-sync", label: "29CM 동기화(iMac)", maxHours: 28, weekdaysOnly: true },
  // 식스샵 동기화 폐지(2026-07) — 해리엇 글로벌 카페24 영문몰(shop_no=2) 이전. launchd 잡도 언로드 필요.
  { key: "heartbeat:postoffice-outbound", label: "우체국 출고빌드(iMac)", maxHours: 28, weekdaysOnly: true },
  { key: "heartbeat:dispatch17", label: "송장입력 dispatch17(iMac)", maxHours: 28, weekdaysOnly: true },
  { key: "heartbeat:register-queue-worker", label: "우체국 접수큐 워커(iMac·상주)", maxHours: 2 },
  { key: "heartbeat:cs-action-worker", label: "CS 액션 워커(iMac·상주)", maxHours: 2 },
  { key: "heartbeat:channel-review-scrape", label: "채널리뷰 수집(주간)", maxHours: 8 * 24 },
  { key: "heartbeat:hrt-scarce-sync", label: "해리엇 품절임박 배지 동기화(iMac)", maxHours: 28 },
  { key: "heartbeat:jed-mail-watch", label: "제드아이티씨 메일 감시(iMac·10분)", maxHours: 2 },
  // Vercel 크론 (cron_last_ok:*) — withCron 적용분 중 핵심
  { key: "cron_last_ok:revenue-snapshot", label: "매출 스냅샷", maxHours: 26 },
  { key: "cron_last_ok:daily-summary", label: "데일리 서머리", maxHours: 26 },
  { key: "cron_last_ok:review-sms-kr", label: "리뷰요청 알림톡", maxHours: 26 },
  { key: "cron_last_ok:kakao-gift-po-sync", label: "카카오선물 주문동기화", maxHours: 26 },
  { key: "cron_last_ok:inventory-sync", label: "재고 동기화", maxHours: 26 },
  { key: "cron_last_ok:as-ship-audit", label: "AS 발송 점검", maxHours: 26 },
  { key: "cron_last_ok:bundle-stock-sync", label: "번들 재고차감", maxHours: 3 },
  { key: "cron_last_ok:mads-evaluate", label: "메타광고 평가", maxHours: 26 },
  { key: "cron_last_ok:bank-deposit-retry", label: "입금확인 재시도", maxHours: 1 },
  { key: "cron_last_ok:parcel-track", label: "우체국 배송추적", maxHours: 14 },
  // 카페24 주문알림 비활성화(2026-07-11 사장님) — 잡을 꺼서 하트비트 미갱신 → 오탐 방지 위해 감시 제외. 재활성화 시 주석 해제.
  // { key: "cron_last_ok:cafe24-orders-notify", label: "카페24 주문알림", maxHours: 2 },
  { key: "cron_last_ok:crm-cart-nudge", label: "장바구니 넛지", maxHours: 3 },
];

const ALERT_DEDUP_H = 6;   // 같은 잡 재경보 간격
const BOOT_GRACE_H = 48;   // 미기록 잡 유예

function kstNow(): Date { return new Date(Date.now() + 9 * 3600_000); }
function isWeekendKst(): boolean { const d = kstNow().getUTCDay(); return d === 0 || d === 6; }

async function run(): Promise<Response> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const keys = JOBS.map((j) => j.key).concat(["watchdog:boot", "watchdog:alerted"]);
  const { data } = await sb.from("kv_store").select("key,data").in("key", keys);
  const map = new Map((data || []).map((r) => [r.key, r.data as Record<string, unknown>]));

  // 최초 가동 시각 (미기록 유예 기준)
  let boot = map.get("watchdog:boot")?.at as string | undefined;
  if (!boot) {
    boot = new Date().toISOString();
    await sb.from("kv_store").upsert({ key: "watchdog:boot", data: { at: boot }, updated_at: boot }, { onConflict: "key" });
  }
  const bootAgeH = (Date.now() - new Date(boot).getTime()) / 3600_000;

  const alerted = (map.get("watchdog:alerted") || {}) as Record<string, string>;
  const now = Date.now();
  const stale: string[] = [];
  const missing: string[] = [];

  for (const j of JOBS) {
    if (j.weekdaysOnly && isWeekendKst()) continue;
    const rec = map.get(j.key);
    const at = rec?.at as string | undefined;
    if (!at) {
      if (bootAgeH >= BOOT_GRACE_H) missing.push(j.label);
      continue;
    }
    const ageH = (now - new Date(at).getTime()) / 3600_000;
    if (ageH > j.maxHours) {
      // 재경보 억제
      const last = alerted[j.key] ? new Date(alerted[j.key]).getTime() : 0;
      if (now - last > ALERT_DEDUP_H * 3600_000) {
        stale.push(`${j.label} — 마지막 ${ageH.toFixed(1)}h 전 (기준 ${j.maxHours}h)`);
        alerted[j.key] = new Date().toISOString();
      }
    }
  }

  if (stale.length || missing.length) {
    const lines = [
      "🚨 <b>자동화 워치독</b> — 하트비트 이상",
      ...(stale.length ? ["", "⏰ <b>기한 초과(실행 안 됨 의심)</b>:", ...stale.map((s) => "· " + s)] : []),
      ...(missing.length ? ["", "❓ 하트비트 미기록(계측 확인 필요): " + missing.join(", ")] : []),
      "",
      "👉 아이맥 전원/로그인·launchd 상태 확인",
    ];
    await sendTelegramMessage(lines.join("\n"));
    await sb.from("kv_store").upsert({ key: "watchdog:alerted", data: alerted, updated_at: new Date().toISOString() }, { onConflict: "key" });
  }

  return Response.json({ ok: true, checked: JOBS.length, stale: stale.length, missing: missing.length });
}

export const GET = withCron("watchdog", run);
