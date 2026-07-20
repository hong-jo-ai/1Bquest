/**
 * AI 성장 전략 플랜 — GET: 캐시(24h) 반환(없으면 생성), POST: 강제 재생성.
 */
import { buildGrowthPlan } from "@/lib/mads/growthStrategist";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const plan = await buildGrowthPlan(false);
    return Response.json({ ok: true, ...plan });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const plan = await buildGrowthPlan(true);
    return Response.json({ ok: true, ...plan });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
