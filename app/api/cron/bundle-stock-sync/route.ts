/**
 * 번들/프로모션 판매 → 기저 SKU 재고 차감 (10분 크론).
 * 매핑(kv cafe24_bundle_components:v1) 비어있으면 no-op.
 */
import { withCron, manualRun } from "@/lib/cron/withCron";
import { syncBundleDeductions } from "@/lib/cafe24/bundleStock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(): Promise<Response> {
  const r = await syncBundleDeductions();
  if (r.error) return Response.json({ ok: false, ...r }, { status: 500 });
  return Response.json({ ok: true, ...r });
}

export const GET = withCron("bundle-stock-sync", () => run());
export const POST = () => manualRun("bundle-stock-sync", () => run());
