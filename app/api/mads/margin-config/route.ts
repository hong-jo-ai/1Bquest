import {
  DEFAULT_MARGIN_CONFIG,
  getMarginConfig,
  resolveThresholds,
  saveMarginConfig,
  type MarginConfig,
} from "@/lib/mads/marginConfig";
import { getActiveSeasonModifier } from "@/lib/mads/seasonModifier";

export const dynamic = "force-dynamic";

export async function GET() {
  const [cfg, season] = await Promise.all([
    getMarginConfig(),
    getActiveSeasonModifier(),
  ]);
  const thresholds = resolveThresholds(cfg, season);
  return Response.json({ ok: true, config: cfg, thresholds, seasonModifier: season });
}

export async function PUT(req: Request) {
  let patch: Partial<MarginConfig>;
  try {
    patch = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 JSON" }, { status: 400 });
  }

  const current = await getMarginConfig();
  const next: MarginConfig = {
    ...DEFAULT_MARGIN_CONFIG,
    ...current,
    ...patch,
    calc:        { ...current.calc, ...(patch.calc ?? {}) },
    multipliers: { ...current.multipliers, ...(patch.multipliers ?? {}) },
    policy:      { ...current.policy, ...(patch.policy ?? {}) },
    updatedAt:   new Date().toISOString(),
  };

  try {
    await saveMarginConfig(next);
    const season = await getActiveSeasonModifier();
    return Response.json({
      ok: true,
      config: next,
      thresholds: resolveThresholds(next, season),
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
