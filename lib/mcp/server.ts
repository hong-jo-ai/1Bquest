/**
 * MCP 서버 코어 — JSON-RPC 디스패치 + 툴. 인증 없는 순수 처리 로직.
 * 두 라우트가 공유: /api/mcp (쿼리·헤더 토큰) / /api/mcp/[secret] (경로 토큰, claude.ai 커넥터용).
 */
import {
  registerInfluencer,
  REGISTER_INFLUENCER_TOOL,
  type RegisterArgs,
} from "@/lib/influencer/register";
import {
  addTodayTask,
  ADD_TODAY_TASK_TOOL,
  type AddTaskArgs,
} from "@/lib/todayHub/addTask";
import { READ_TOOLS, READ_TOOL_NAMES, callReadTool } from "@/lib/mcp/dashboardTools";

export const PROTOCOL_VERSION = "2025-06-18";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export const TOOLS = [REGISTER_INFLUENCER_TOOL, ADD_TODAY_TASK_TOOL, ...READ_TOOLS];

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

async function handleRpc(msg: JsonRpcRequest) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // 알림: 응답 안 함
  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "paulwise-dashboard", version: "1.0.0" },
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
      case "tools/call": {
        const toolName = params?.name as string | undefined;
        const args = (params?.arguments as Record<string, unknown>) || {};
        if (toolName === "register_influencer") {
          const result = await registerInfluencer(args as RegisterArgs);
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.ok } };
        }
        if (toolName === "add_today_task") {
          const result = await addTodayTask(args as AddTaskArgs);
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.ok } };
        }
        if (toolName && READ_TOOL_NAMES.has(toolName)) {
          const r = await callReadTool(toolName, args);
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: r.text }], isError: r.isError } };
        }
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
    }
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : "Internal error" } };
  }
}

/** 파싱된 요청(request Body)을 받아 MCP 응답 Response 생성 (배열/단건/알림 202 처리). */
export async function respondToMcp(req: Request): Promise<Response> {
  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { headers: CORS_HEADERS });
  }
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map(handleRpc))).filter((r) => r !== null);
    if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return Response.json(responses, { headers: CORS_HEADERS });
  }
  const response = await handleRpc(body);
  if (response === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return Response.json(response, { headers: CORS_HEADERS });
}

/** GET용 서버 정보 응답. */
export function serverInfoResponse(): Response {
  return Response.json(
    { name: "paulwise-mcp", description: "paulwise-dashboard MCP server", protocolVersion: PROTOCOL_VERSION, tools: TOOLS.map((t) => t.name) },
    { headers: CORS_HEADERS },
  );
}
