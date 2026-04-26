import { getProfitSettings, saveProfitSettings, type ProfitSettings } from "@/lib/profitSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getProfitSettings();
    return Response.json({ ok: true, settings });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const patch = (await req.json()) as Partial<ProfitSettings>;
    await saveProfitSettings(patch);
    const settings = await getProfitSettings();
    return Response.json({ ok: true, settings });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
