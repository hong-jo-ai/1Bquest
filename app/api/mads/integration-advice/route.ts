import { buildIntegrationAdvice } from "@/lib/mads/integrationAdvisor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const advice = await buildIntegrationAdvice();
    return Response.json({ ok: true, advice });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
