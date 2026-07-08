/**
 * 캠페인(CBO) 일예산 조회·변경 — manual-budget-bump 는 광고세트 예산 전용이라
 * CBO 캠페인(예: 에끌라 오벌 골드)은 이 라우트로 캠페인 예산을 직접 조정한다.
 *
 *   GET  ?campaignId=...            → 현재 name/status/daily_budget
 *   POST {campaignId, dailyBudgetKrw, confirm}
 *        confirm 없으면 dryRun (변경 전/후 금액만 반환)
 *
 * 변경 시 mads_manual_action_logs 에 source='manual' 로 기록해 감사 추적을 남긴다.
 */
import { metaGet, metaPost } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { logManualAction } from "@/lib/mads/wobbleDetector";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MIN_BUDGET_KRW = 5_000;
const MAX_BUDGET_KRW = 1_000_000;

async function fetchCampaign(token: string, campaignId: string) {
  return metaGet(`/${campaignId}`, token, {
    fields: "id,name,status,effective_status,daily_budget,lifetime_budget",
  }) as Promise<{
    id: string;
    name: string;
    status: string;
    effective_status: string;
    daily_budget?: string;
    lifetime_budget?: string;
  }>;
}

export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  if (!campaignId) {
    return Response.json({ ok: false, error: "campaignId 필요" }, { status: 400 });
  }
  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "Meta 토큰 없음" }, { status: 500 });

  try {
    const c = await fetchCampaign(token, campaignId);
    return Response.json({ ok: true, campaign: c });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { campaignId?: string; dailyBudgetKrw?: number; confirm?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 요청 본문" }, { status: 400 });
  }

  const campaignId = body.campaignId?.trim();
  const next = Math.round(Number(body.dailyBudgetKrw));
  if (!campaignId) {
    return Response.json({ ok: false, error: "campaignId 필요" }, { status: 400 });
  }
  if (!Number.isFinite(next) || next < MIN_BUDGET_KRW || next > MAX_BUDGET_KRW) {
    return Response.json(
      { ok: false, error: `dailyBudgetKrw 는 ${MIN_BUDGET_KRW}~${MAX_BUDGET_KRW} 사이` },
      { status: 400 },
    );
  }

  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "Meta 토큰 없음" }, { status: 500 });

  let current: Awaited<ReturnType<typeof fetchCampaign>>;
  try {
    current = await fetchCampaign(token, campaignId);
  } catch (e) {
    return Response.json(
      { ok: false, error: `캠페인 조회 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
  const cur = Number(current.daily_budget);
  if (!Number.isFinite(cur) || cur <= 0) {
    return Response.json(
      { ok: false, error: "이 캠페인엔 daily_budget 이 없음 (세트 예산 캠페인이면 manual-budget-bump 사용)" },
      { status: 400 },
    );
  }

  if (!body.confirm) {
    return Response.json({
      ok: true,
      dryRun: true,
      campaign: { id: current.id, name: current.name, status: current.effective_status },
      from: cur,
      to: next,
    });
  }

  try {
    await metaPost(`/${campaignId}`, token, { daily_budget: String(next) });
  } catch (e) {
    return Response.json(
      { ok: false, error: `Meta 업데이트 실패: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  await logManualAction(campaignId, "campaign_budget_change", "manual", {
    from: cur,
    to: next,
    campaign_name: current.name,
  });

  return Response.json({ ok: true, campaign: { id: current.id, name: current.name }, from: cur, to: next });
}
