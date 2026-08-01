/**
 * MCP Streamable HTTP endpoint — 쿼리(?token=) 또는 Authorization: Bearer 인증.
 * 코어 로직은 lib/mcp/server.ts 공유. 경로 토큰 방식(claude.ai 커넥터 권장)은 /api/mcp/[secret].
 */
import { NextRequest } from "next/server";
import { CORS_HEADERS, respondToMcp, serverInfoResponse } from "@/lib/mcp/server";

function authOk(req: NextRequest): boolean {
  const expected = process.env.PAULWISE_MCP_TOKEN;
  if (!expected) return false;
  const fromQuery = req.nextUrl.searchParams.get("token");
  if (fromQuery && fromQuery === expected) return true;
  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${expected}`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  return serverInfoResponse();
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  return respondToMcp(req);
}
