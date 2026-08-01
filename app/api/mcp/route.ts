/**
 * MCP (Model Context Protocol) Streamable HTTP endpoint.
 *
 * claude.ai 데스크톱(웹/맥앱)의 custom integration으로 등록해서
 * "이 사람 등록해줘" 같은 요청으로 paulwise 대시보드에 인플루언서를
 * 직접 추가하는 용도. 모바일 claude.ai는 custom connector 미지원이라
 * 모바일은 Telegram bot(/api/telegram/webhook)으로 처리.
 *
 * 인증: 쿼리 ?token=... 또는 Authorization: Bearer ...
 *   - 환경변수 PAULWISE_MCP_TOKEN 과 일치해야 통과.
 */
import { NextRequest } from "next/server";
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

const PROTOCOL_VERSION = "2025-06-18";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function authOk(req: NextRequest): boolean {
  const expected = process.env.PAULWISE_MCP_TOKEN;
  if (!expected) return false;
  const fromQuery = req.nextUrl.searchParams.get("token");
  if (fromQuery && fromQuery === expected) return true;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${expected}`) return true;
  return false;
}

const TOOLS = [REGISTER_INFLUENCER_TOOL, ADD_TODAY_TASK_TOOL, ...READ_TOOLS];

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

async function handleRpc(msg: JsonRpcRequest) {
  const { id, method, params } = msg || {};

  // 알림(id 없음): 응답 안 함
  if (id === undefined || id === null) return null;

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
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              isError: !result.ok,
            },
          };
        }
        if (toolName === "add_today_task") {
          const result = await addTodayTask(args as AddTaskArgs);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              isError: !result.ok,
            },
          };
        }
        if (toolName && READ_TOOL_NAMES.has(toolName)) {
          const r = await callReadTool(toolName, args);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: r.text }],
              isError: r.isError,
            },
          };
        }
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown method: ${method}` },
        };
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Internal error";
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: errMsg },
    };
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: CORS_HEADERS,
    });
  }
  return Response.json(
    {
      name: "paulwise-mcp",
      description: "paulwise-dashboard MCP server",
      protocolVersion: PROTOCOL_VERSION,
      tools: TOOLS.map((t) => t.name),
    },
    { headers: CORS_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: CORS_HEADERS,
    });
  }

  let body: JsonRpcRequest | JsonRpcRequest[];
  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { headers: CORS_HEADERS },
    );
  }

  if (Array.isArray(body)) {
    const responses = await Promise.all(body.map(handleRpc));
    const filtered = responses.filter((r) => r !== null);
    if (filtered.length === 0) {
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    }
    return Response.json(filtered, { headers: CORS_HEADERS });
  }

  const response = await handleRpc(body);
  if (response === null) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }
  return Response.json(response, { headers: CORS_HEADERS });
}
