/**
 * MCP 엔드포인트 — 경로 토큰 인증: /api/mcp/<PAULWISE_MCP_TOKEN>
 *
 * claude.ai 커스텀 커넥터 전용. 커넥터는 401을 받으면 OAuth 등록을 시도하는데
 * 우리는 OAuth가 없다 → 경로에 토큰을 넣어 항상 200을 주면 커넥터가 OAuth 없이 바로 연결한다.
 * 잘못된 토큰은 401이 아니라 **404**(리소스 없음)로 응답해 OAuth 트리거를 피한다.
 */
import { NextRequest } from "next/server";
import { CORS_HEADERS, respondToMcp, serverInfoResponse } from "@/lib/mcp/server";

function pathOk(secret: string): boolean {
  const expected = process.env.PAULWISE_MCP_TOKEN;
  return Boolean(expected) && secret === expected;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (!pathOk(secret)) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  return serverInfoResponse();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (!pathOk(secret)) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  return respondToMcp(req);
}
