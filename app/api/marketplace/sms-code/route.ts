/**
 * W컨셉 SMS 인증번호 조회 — 로컬 에이전트(크론)가 폴링.
 *
 * 사장님이 텔레그램에 "wc 123456" 보내면 webhook 이 저장 → 에이전트가 여기서 가져감.
 * after(ISO) 보다 새 코드만 반환해, 직전 로그인에서 쓴 옛 코드를 다시 쓰지 않게 함.
 *
 * GET /api/marketplace/sms-code?after=<ISO>   헤더: x-agent-token: <PAULWISE_MCP_TOKEN>
 *   → { code: "123456", ts } | { code: null }
 */
import { type NextRequest } from "next/server";
import { getSmsCode } from "@/lib/marketplace/smsCode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const after = req.nextUrl.searchParams.get("after");
  const entry = await getSmsCode();
  if (!entry) return Response.json({ code: null });
  if (after && entry.ts <= after) return Response.json({ code: null, stale: true });
  return Response.json({ code: entry.code, ts: entry.ts });
}
