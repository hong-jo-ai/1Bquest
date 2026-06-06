/**
 * on-demand 동기화 요청 조회 — 아이맥 triggerWatcher.js가 폴링.
 *
 * GET /api/marketplace/sync-request   헤더: x-agent-token: <PAULWISE_MCP_TOKEN>
 *   → { channel: "wconcept", ts } | { channel: null }
 */
import { type NextRequest } from "next/server";
import { getSyncRequest } from "@/lib/marketplace/syncRequest";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const reqData = await getSyncRequest();
  if (!reqData) return Response.json({ channel: null });
  return Response.json({ channel: reqData.channel, ts: reqData.ts });
}
