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
import { getCampaign, saveCampaign, buildTargetsFromWaitlist, enrollTargets, markSentAll } from "@/lib/crm/campaign";

export const runtime = "nodejs";

const SEOLWOL_PRODUCT_NO = 136;
const KR_LANDING = "https://harriotwatches.co.kr/product/detail.html?product_no=136";

/**
 * 실발송 뒤 CRM 캠페인으로 등록 — 대시보드 CRM 섹션이 이 발송의 전환·매출을 추적하게.
 * 설월 런칭 발송(9/10)이 여기를 안 거쳐 CRM 이 비어 있었고, 사후에 손으로 넣어야 했다(2026-09-13).
 * 등록 실패가 발송 결과 응답을 막으면 안 되므로 예외는 삼키고 crm 필드로 알린다.
 */
async function registerCrmCampaign(campaign: string, landingUrl: string, message: string, sentAt: string) {
  try {
    if (await getCampaign(campaign)) return { registered: false, reason: "already_exists" };
    const leads = await buildTargetsFromWaitlist();
    await saveCampaign({
      id: campaign, name: `해리엇 대기명단 발송 (${campaign}, ${leads.length}명)`, brand: "harriot",
      productNo: SEOLWOL_PRODUCT_NO, landingUrl, message, status: "sent", createdAt: sentAt, sentAt,
    });
    const targets = await enrollTargets(campaign, leads, 0); // 대기명단은 직접 요청한 사람들이라 홀드아웃 없이 전원 발송
    const marked = await markSentAll(campaign, sentAt);
    return { registered: true, targets: targets.length, marked };
  } catch (e) {
    return { registered: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

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
      kr: buildKrText(KR_LANDING),
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

  // 명단 전체에 실제로 나간 경우에만 CRM 등록(dry-run·차단·테스트 발송은 제외)
  const realSend = !result.dryRun && !result.blocked && !body?.testOnly;
  const crm = realSend
    ? await registerCrmCampaign(campaign, body?.landingUrl ?? KR_LANDING, result.krPreview, new Date().toISOString())
    : null;

  return NextResponse.json({ ok: !result.blocked, ...result, crm });
}
