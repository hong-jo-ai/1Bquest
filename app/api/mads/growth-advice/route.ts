import { buildGrowthAdvice } from "@/lib/mads/growthAdvisor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await buildGrowthAdvice();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
