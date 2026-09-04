/**
 * 설월 출시 알림 일괄 발송 (운영자 전용).
 *
 * 공개 경로가 **아니다** — proxy.ts 에 추가하지 말 것. 대시보드 로그인 or x-agent-token 이 필요하다.
 * 대기명단 수집 API(/api/harriot/waitlist)와 헷갈리지 말 것: 그건 익명 공개, 이건 발송이라 잠근다.
 *
 * GET  → 현재 명단 수 + 발송 이력 + 문구 미리보기 (아무것도 보내지 않음)
 * POST → confirm 이 정확히 `SEND:<campaign>` 일 때만 실제 발송. 그 외에는 dry-run 미리보기.
 */
import { NextRequest, NextResponse } from "next/server";
import { waitlistSummary } from "@/lib/harriot/waitlist";
import { runBlast, readBlastLog, buildKrText, buildEnSubject, buildEnBody } from "@/lib/harriot/waitlistBlast";

export const runtime = "nodejs";

function agentAuthed(req: NextRequest): boolean {
  const token = process.env.PAULWISE_MCP_TOKEN;
  return !!token && req.headers.get("x-agent-token") === token;
}

export async function GET(req: NextRequest) {
  const s = await waitlistSummary();
  return NextResponse.json({
    counts: { total: s.total, kr: s.kr, en: s.en, marketingOptIn: s.marketingOptIn },
    bySource: s.bySource,
    sentCampaigns: await readBlastLog(),
    preview: {
      kr: buildKrText("https://harriotwatches.co.kr/product/detail.html?product_no=136"),
      en: { subject: buildEnSubject(), body: buildEnBody("https://harriotwatches.com/product/detail.html?product_no=136") },
    },
    hint: "발송하려면 POST + { campaign, confirm: 'SEND:<campaign>' }. confirm 없으면 dry-run.",
  });
}

export async function POST(req: NextRequest) {
  if (!agentAuthed(req)) {
    // 대시보드 세션으로 들어온 경우는 proxy 가 이미 인증했다. 토큰도 세션도 없으면 거부.
    const hasSession = req.cookies.get("pv_session") ?? req.cookies.get("session");
    if (!hasSession) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const campaign = String(body?.campaign ?? "").trim();
  if (!campaign) return NextResponse.json({ ok: false, error: "campaign_required" }, { status: 400 });

  const s = await waitlistSummary();
  const result = await runBlast(
    {
      campaign,
      confirm: body?.confirm,
      testOnly: body?.testOnly,
      landingUrl: body?.landingUrl,
      evenIfNight: !!body?.evenIfNight,
    },
    s.rows,
  );

  return NextResponse.json({ ok: !result.blocked, ...result });
}
