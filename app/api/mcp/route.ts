/**
 * MCP (Model Context Protocol) Streamable HTTP endpoint.
 *
 * claude.ai의 custom integration으로 등록해서 모바일/웹 채팅에서
 * "이 사람 등록해줘" 같은 요청으로 paulwise 대시보드에 인플루언서를
 * 직접 추가하는 용도.
 *
 * 인증: 쿼리 ?token=... 또는 Authorization: Bearer ...
 *   - 환경변수 PAULWISE_MCP_TOKEN 과 일치해야 통과.
 *
 * 저장: kv_store 테이블의 paulvice_influencers_v1 키
 *   - 앱(InfluencerManager)이 다음 마운트에서 자동 sync.
 */
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PROTOCOL_VERSION = "2025-06-18";
const INFLUENCERS_KEY = "paulvice_influencers_v1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function authOk(req: NextRequest): boolean {
  const expected = process.env.PAULWISE_MCP_TOKEN;
  if (!expected) return false;
  const fromQuery = req.nextUrl.searchParams.get("token");
  if (fromQuery && fromQuery === expected) return true;
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${expected}`) return true;
  return false;
}

// ── 도구 정의 ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "register_influencer",
    description:
      "발굴한 인플루언서를 paulwise 대시보드(인플루언서 발굴 도구)에 등록합니다. " +
      "정보가 부분적이어도 OK — 모르는 필드는 비워두세요. " +
      "등록 후 status는 자동으로 'discovered'(발굴됨)로 설정. " +
      "사용자가 인스타 스크린샷을 첨부하면 거기서 handle/name/팔로워/카테고리를 읽어 채워주세요.",
    inputSchema: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: ["instagram", "youtube", "tiktok"],
          description: "플랫폼",
        },
        handle: {
          type: "string",
          description: "사용자 ID (@ 제외, 예: '@hong_sj' → 'hong_sj')",
        },
        name: {
          type: "string",
          description: "표시 이름 (모르면 handle과 동일하게)",
        },
        followers: {
          type: "number",
          description: "팔로워 수 (모르면 생략)",
        },
        engagement_rate: {
          type: "number",
          description: "참여율 % (예: 3.5). 모르면 생략",
        },
        categories: {
          type: "array",
          items: { type: "string" },
          description:
            "카테고리 태그 (예: ['패션', '라이프스타일', '뷰티']). 모르면 빈 배열",
        },
        priority: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "우선순위 (기본 medium)",
        },
        notes: {
          type: "string",
          description:
            "메모 — 왜 등록했는지, 어떤 점이 매력적이었는지 등 (선택)",
        },
        profile_image: {
          type: "string",
          description: "프로필 이미지 URL (선택)",
        },
      },
      required: ["platform", "handle", "name"],
    },
  },
];

// ── 비즈니스 로직 ────────────────────────────────────────────────────

type Platform = "instagram" | "youtube" | "tiktok";
type Priority = "high" | "medium" | "low";

interface StoredInfluencer {
  id: string;
  platform: Platform;
  handle: string;
  name: string;
  profileImage: string;
  followers: number;
  engagementRate: number;
  categories: string[];
  status: string;
  priority: Priority;
  notes: string;
  addedAt: string;
  updatedAt: string;
  messages: unknown[];
}

async function getInfluencerList(
  supabase: SupabaseClient,
): Promise<StoredInfluencer[]> {
  const { data } = await supabase
    .from("kv_store")
    .select("data")
    .eq("key", INFLUENCERS_KEY)
    .maybeSingle();
  const raw = data?.data;
  return Array.isArray(raw) ? (raw as StoredInfluencer[]) : [];
}

async function saveInfluencerList(
  supabase: SupabaseClient,
  list: StoredInfluencer[],
): Promise<void> {
  const { error } = await supabase
    .from("kv_store")
    .upsert(
      {
        key: INFLUENCERS_KEY,
        data: list,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  if (error) throw new Error(`KV 저장 실패: ${error.message}`);
}

interface RegisterArgs {
  platform?: string;
  handle?: string;
  name?: string;
  followers?: number;
  engagement_rate?: number;
  categories?: string[];
  priority?: string;
  notes?: string;
  profile_image?: string;
}

async function registerInfluencer(args: RegisterArgs) {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: "DB 미설정 (SUPABASE_URL/KEY 확인)" };
  }

  const platform = String(args.platform || "").toLowerCase() as Platform;
  if (!["instagram", "youtube", "tiktok"].includes(platform)) {
    return {
      ok: false,
      error: "platform은 instagram / youtube / tiktok 중 하나여야 합니다",
    };
  }

  const handle = String(args.handle || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
  if (!handle) return { ok: false, error: "handle 필요" };

  const name = String(args.name || "").trim() || handle;

  const list = await getInfluencerList(supabase);
  const existing = list.find(
    (x) => x.handle?.toLowerCase() === handle && x.platform === platform,
  );
  if (existing) {
    return {
      ok: false,
      duplicate: true,
      message: `이미 등록되어 있습니다: @${handle} (${platform}, 현재 상태=${existing.status})`,
      id: existing.id,
    };
  }

  const priorityRaw = String(args.priority || "medium").toLowerCase();
  const priority: Priority = (
    ["high", "medium", "low"].includes(priorityRaw) ? priorityRaw : "medium"
  ) as Priority;

  const now = new Date().toISOString();
  const newInf: StoredInfluencer = {
    id: crypto.randomUUID(),
    platform,
    handle,
    name,
    profileImage: String(args.profile_image || ""),
    followers: Number.isFinite(Number(args.followers))
      ? Number(args.followers)
      : 0,
    engagementRate: Number.isFinite(Number(args.engagement_rate))
      ? Number(args.engagement_rate)
      : 0,
    categories: Array.isArray(args.categories)
      ? args.categories.filter((c) => typeof c === "string")
      : [],
    status: "discovered",
    priority,
    notes: String(args.notes || ""),
    addedAt: now,
    updatedAt: now,
    messages: [],
  };

  await saveInfluencerList(supabase, [...list, newInf]);

  return {
    ok: true,
    id: newInf.id,
    message: `✅ 등록 완료: @${handle} (${platform}, ${name}) — 대시보드 인플루언서 도구에서 확인 가능`,
  };
}

// ── JSON-RPC 핸들러 ──────────────────────────────────────────────────

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
        const args = (params?.arguments as RegisterArgs) || {};
        if (toolName === "register_influencer") {
          const result = await registerInfluencer(args);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                { type: "text", text: JSON.stringify(result, null, 2) },
              ],
              isError: !result.ok,
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
    const msg = e instanceof Error ? e.message : "Internal error";
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: msg },
    };
  }
}

// ── HTTP 핸들러 ──────────────────────────────────────────────────────

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
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
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
