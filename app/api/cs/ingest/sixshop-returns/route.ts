/**
 * 식스샵 반품/교환/취소 클레임 적재 — 로컬 에이전트(sixshopCsSync.js)가 파싱해 POST.
 * 식스샵은 CS API가 없어 서버가 직접 못 긁으므로, 에이전트가 보낸 파싱 결과를 받아 upsert.
 * 헤더: x-agent-token: <PAULWISE_MCP_TOKEN>. Body: { claims: SixshopClaimInput[] }
 */
import { type NextRequest } from "next/server";
import { upsertSixshopClaim, type SixshopClaimInput } from "@/lib/cs/sixshopIngest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { claims?: SixshopClaimInput[] };
  const claims = Array.isArray(body.claims) ? body.claims : [];
  let inserted = 0, updated = 0, skipped = 0, failed = 0;
  for (const c of claims) {
    if (!c?.orderNumber || !c?.claimType || !c?.status) { failed++; continue; }
    try {
      const r = await upsertSixshopClaim(c);
      if (r.skipped) skipped++;
      else if (r.inserted) inserted++;
      else updated++;
    } catch {
      failed++;
    }
  }
  return Response.json({ ok: true, received: claims.length, inserted, updated, skipped, failed });
}
