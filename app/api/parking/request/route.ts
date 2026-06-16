/**
 * on-demand 주차할인 등록 요청 조회 — 아이맥 triggerWatcher.js가 폴링.
 * GET /api/parking/request   헤더: x-agent-token: <PAULWISE_MCP_TOKEN>
 *   → { carNo: "4330", ts } | { carNo: null }
 */
import { type NextRequest } from "next/server";
import { getParkingRequest } from "@/lib/parking/request";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const reqData = await getParkingRequest();
  if (!reqData) return Response.json({ carNo: null });
  return Response.json({ carNo: reqData.carNo, ts: reqData.ts });
}
