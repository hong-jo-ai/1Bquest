/**
 * 신상 출시 CRM 캠페인 — 생성·대상산출·성과조회.
 *
 * GET  /api/crm/campaigns                 → 캠페인 목록 + 각 퍼널 요약
 * GET  /api/crm/campaigns?preview=1&sinceDays=180
 *        → 발송 가능 대상 미리보기(자사몰 직접구매자만). 실제 등록은 안 함
 * POST /api/crm/campaigns
 *        { name, landingUrl, productNo?, couponCode?, message?, sinceDays?, confirm }
 *        confirm 없으면 dryRun(대상 수만 계산). confirm:true 면 캠페인 생성 + 1인 1코드 발급
 *        → { campaign, targets:[{name, phone, code, link}] }  ← 이 link 를 문자에 넣는다
 */
import { type NextRequest } from "next/server";
import {
  listCampaigns, saveCampaign, funnelOf, buildLeads, enrollTargets,
  type Campaign,
} from "@/lib/crm/campaign";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://paulvice-dashboard.vercel.app";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    if (sp.get("preview")) {
      const sinceDays = Number(sp.get("sinceDays") || 180);
      const brand = sp.get("brand") === "harriot" ? "harriot" : sp.get("brand") === "paulvice" ? "paulvice" : undefined;
      const waitlistKey = sp.get("waitlist");   // 예: harriot:seolwol:waitlist:v1 · "none"이면 제외
      const people = await buildLeads({
        brand, sinceDays,
        waitlistKey: waitlistKey === "none" ? null : waitlistKey,
        includeShipments: sp.get("shipments") !== "0",
      });
      const bySource: Record<string, number> = {}, byChannel: Record<string, number> = {};
      for (const p of people) { bySource[p.source] = (bySource[p.source] ?? 0) + 1; byChannel[p.channel] = (byChannel[p.channel] ?? 0) + 1; }
      return Response.json({
        ok: true, sinceDays, brand: brand ?? "all", count: people.length, bySource, byChannel,
        note: "구매자는 자사몰 직접구매만(마켓 경유는 광고 발송 불가). 대기명단은 본인이 알림을 요청한 사람이라 우선 채택.",
        sample: people.slice(0, 5).map((p) => ({
          name: p.name, channel: p.channel, source: p.source,
          contact: p.email ? p.email.replace(/(.{3}).*(@.*)/, "$1***$2") : (p.phone ?? "").replace(/(\d{3})\d{4}(\d{4})/, "$1****$2"),
        })),
      });
    }
    const campaigns = await listCampaigns();
    const withFunnel = await Promise.all(campaigns.map(async (c) => ({ ...c, funnel: await funnelOf(c.id) })));
    return Response.json({ ok: true, campaigns: withFunnel });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let b: {
    name?: string; landingUrl?: string; productNo?: number; couponCode?: string;
    message?: string; sinceDays?: number; confirm?: boolean; brand?: "paulvice" | "harriot";
    waitlistKey?: string | null; includeShipments?: boolean; holdoutRatio?: number;
  };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 }); }
  if (!b.name || !b.landingUrl) return Response.json({ ok: false, error: "name, landingUrl 필요" }, { status: 400 });

  try {
    const people = await buildLeads({
      brand: b.brand, sinceDays: b.sinceDays ?? 180,
      waitlistKey: b.waitlistKey, includeShipments: b.includeShipments,
    });
    if (!b.confirm) {
      return Response.json({
        ok: true, dryRun: true, targetCount: people.length,
        message: "confirm:true 를 보내면 캠페인을 만들고 1인 1코드를 발급합니다.",
      });
    }
    const campaign: Campaign = {
      id: `cmp_${Date.now().toString(36)}`,
      name: b.name, landingUrl: b.landingUrl,
      productNo: b.productNo ?? null, couponCode: b.couponCode ?? null,
      message: b.message ?? null, status: "draft", createdAt: new Date().toISOString(),
    };
    await saveCampaign(campaign);
    // 기본 10% 는 일부러 안 보낸다 — 이 대조군이 없으면 '문자 덕분'인지 영영 모른다.
    const targets = await enrollTargets(campaign.id, people, b.holdoutRatio ?? 0.1);
    return Response.json({
      ok: true, campaign,
      counts: {
        total: targets.length,
        sms: targets.filter((t) => t.channel === "sms" && !t.holdout).length,
        email: targets.filter((t) => t.channel === "email" && !t.holdout).length,
        holdout: targets.filter((t) => t.holdout).length,
      },
      // 홀드아웃은 발송 목록에서 빼서 내보낸다 — 실수로라도 보내면 대조군이 깨진다.
      targets: targets.filter((t) => !t.holdout).map((t) => ({ name: t.name, channel: t.channel, source: t.source, phone: t.phone, email: t.email, code: t.code, link: `${BASE}/c/${t.code}` })),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
