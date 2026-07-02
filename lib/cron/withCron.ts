/**
 * Vercel 크론 공통 래퍼 — 시스템 감사(2026-07-02) 조치.
 *
 * 해결하는 문제 3가지:
 *  1) 실패해도 아무도 모름   → throw 시 텔레그램 즉시 알림
 *  2) 인증 fail-open/부재    → CRON_SECRET Bearer 강제 (모든 GET 크론)
 *  3) "실행 안 됨" 무감지    → 성공 시 kv `cron_last_ok:<name>` 하트비트 → /api/cron/watchdog 이 감시
 *
 * 사용:
 *   export const GET = withCron("revenue-snapshot", async (req) => { ...; return Response.json({ok:true}); });
 *
 * 주의: 핸들러가 내부에서 에러를 삼키고 200을 반환하면 래퍼는 성공으로 기록한다.
 *       (핸들러는 진짜 실패를 throw 하거나 5xx 로 반환할 것 — 5xx 도 실패로 간주해 알림.)
 */
import { createClient } from "@supabase/supabase-js";
import { sendTelegramMessage } from "@/lib/cs/telegram";

type Handler = (req: Request) => Promise<Response>;

function kv() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function recordHeartbeat(name: string, ok: boolean, ms: number, note?: string) {
  try {
    const sb = kv(); if (!sb) return;
    await sb.from("kv_store").upsert(
      { key: `cron_last_ok:${name}`, data: { at: new Date().toISOString(), ok, ms, note: (note || "").slice(0, 200) }, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  } catch { /* 하트비트 실패가 크론을 막으면 안 됨 */ }
}

async function alertFail(name: string, detail: string) {
  try {
    await sendTelegramMessage(`🔴 <b>크론 실패</b> — ${name}\n${detail.slice(0, 500)}`);
  } catch { /* 알림 실패는 삼킴 */ }
}

export function withCron(name: string, handler: Handler): Handler {
  return async (req: Request) => {
    // ── 인증: CRON_SECRET 강제 (fail-open 금지) ──
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (!secret) {
      // env 누락 = 설정 사고. 실행은 막고 알림.
      await alertFail(name, "CRON_SECRET env 누락 — 크론 인증 불가 상태");
      return Response.json({ error: "CRON_SECRET missing" }, { status: 500 });
    }
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const t0 = Date.now();
    try {
      const res = await handler(req);
      const ms = Date.now() - t0;
      if (res.status >= 500) {
        // 핸들러가 5xx 반환 = 실패로 간주
        const body = await res.clone().text().catch(() => "");
        await alertFail(name, `HTTP ${res.status} ${body.slice(0, 300)}`);
        await recordHeartbeat(name, false, ms, `HTTP ${res.status}`);
      } else {
        await recordHeartbeat(name, true, ms);
      }
      return res;
    } catch (e) {
      const ms = Date.now() - t0;
      const msg = e instanceof Error ? `${e.message}\n${(e.stack || "").split("\n").slice(1, 3).join("\n")}` : String(e);
      await alertFail(name, msg);
      await recordHeartbeat(name, false, ms, msg.slice(0, 100));
      return Response.json({ ok: false, error: msg.slice(0, 300) }, { status: 500 });
    }
  };
}
