/**
 * 해리엇 과거 해외 구매자 설월 소식 메일 발송 (운영자 전용 — proxy.ts 에 추가하지 말 것).
 *
 * 대상은 미리 CRM 캠페인에 등록돼 있어야 한다(crm_campaign_targets, channel=email).
 * POST { campaign, confirm?: "SEND:<campaign>", testOnly?: { email, name?, products? }, limit? }
 *   confirm 없으면 dry-run(대상 수 + 첫 통 미리보기). 한 번에 limit(기본 80)통, remaining 이 0 될 때까지 재호출.
 */
import { NextRequest, NextResponse } from "next/server";
import { runPastBuyerBlast } from "@/lib/harriot/pastBuyerBlast";

export const runtime = "nodejs";
export const maxDuration = 300;

function agentAuthed(req: NextRequest): boolean {
  const token = process.env.PAULWISE_MCP_TOKEN;
  return !!token && req.headers.get("x-agent-token") === token;
}

export async function POST(req: NextRequest) {
  if (!agentAuthed(req)) {
    const hasSession = req.cookies.get("paulwise_session");
    if (!hasSession) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const campaign = String(body?.campaign ?? "").trim();
  if (!campaign) return NextResponse.json({ ok: false, error: "campaign_required" }, { status: 400 });
  const result = await runPastBuyerBlast({ campaign, confirm: body?.confirm, testOnly: body?.testOnly, limit: body?.limit });
  return NextResponse.json({ ok: !result.blocked, ...result });
}
