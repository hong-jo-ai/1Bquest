/**
 * 장바구니 이탈 넛지 크론 — 매시간. 두 몰(폴바이스+해리엇) 미구매 카트에 단계별(1h/24h/72h) 발송.
 * 안전장치: CRM_CART_NUDGE_ENABLED = "1"/"true"/"on" 일 때만 실제 발송(아니면 dryRun 카운트만).
 *   GET + Authorization: Bearer ${CRON_SECRET}  (Vercel cron)
 *   POST ?manual=1                               (수동 트리거)
 */
import { runCartNudge } from "@/lib/crm/cartNudge";
import { type CrmMall } from "@/lib/crm/cartStore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MALLS: CrmMall[] = ["paulvice", "harriot"];

function enabled(): boolean {
  const v = (process.env.CRM_CART_NUDGE_ENABLED || "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

async function run() {
  const dryRun = !enabled();
  const malls: Record<string, unknown> = {};
  for (const mall of MALLS) {
    try {
      malls[mall] = await runCartNudge(mall, { dryRun });
    } catch (e) {
      malls[mall] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return Response.json({ ok: true, dryRun, malls });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try { return await run(); }
  catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

export async function POST() {
  try { return await run(); }
  catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
