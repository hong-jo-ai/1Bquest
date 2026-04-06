/**
 * GET /api/agents/status
 * 에이전트 상태, 최근 태스크, 이벤트 조회
 * Query: ?key=state|tasks|events|results&agentId=optional
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const KEYS = {
  state: "paulvice_agent_state_v1",
  tasks: "paulvice_agent_tasks_v1",
  events: "paulvice_agent_events_v1",
  results: "paulvice_agent_results_v1",
} as const;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "state";
  const agentId = req.nextUrl.searchParams.get("agentId");
  const kvKey = KEYS[key as keyof typeof KEYS] ?? KEYS.state;

  const supabase = getClient();
  if (!supabase) {
    return Response.json({ data: null, reason: "DB_NOT_CONFIGURED" });
  }

  try {
    const { data, error } = await supabase
      .from("kv_store")
      .select("data")
      .eq("key", kvKey)
      .maybeSingle();

    if (error) throw error;

    let result = data?.data ?? null;

    // agentId 필터
    if (agentId && Array.isArray(result)) {
      result = result.filter((item: { agentId?: string }) => item.agentId === agentId);
    }

    return Response.json({ data: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ data: null, error: message });
  }
}
