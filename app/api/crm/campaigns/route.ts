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
  listCampaigns, saveCampaign, funnelOf, buildTargetsFromShipments, enrollTargets,
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
      const people = await buildTargetsFromShipments(sinceDays, { brand });
      return Response.json({
        ok: true, sinceDays, brand: brand ?? "all", count: people.length,
        note: "자사몰 직접구매 고객만. 마켓(무신사·W컨셉·29CM·공구·카카오) 경유 고객은 광고 발송 불가라 제외됨",
        sample: people.slice(0, 5).map((p) => ({ name: p.name, phone: p.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2"), orders: p.orders, lastAt: p.lastAt.slice(0, 10) })),
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
  };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "본문 파싱 실패" }, { status: 400 }); }
  if (!b.name || !b.landingUrl) return Response.json({ ok: false, error: "name, landingUrl 필요" }, { status: 400 });

  try {
    const people = await buildTargetsFromShipments(b.sinceDays ?? 180, { brand: b.brand });
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
    const targets = await enrollTargets(campaign.id, people.map((p) => ({ name: p.name, phone: p.phone })));
    return Response.json({
      ok: true, campaign,
      targets: targets.map((t) => ({ name: t.name, phone: t.phone, code: t.code, link: `${BASE}/c/${t.code}` })),
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
