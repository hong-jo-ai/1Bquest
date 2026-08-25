/**
 * 광고세트 타겟팅(연령·성별) 조회 — 읽기 전용. 2026-08-25 신설.
 *
 * 왜 필요한가: mads_ad_sets 에는 예산·상태만 쌓이고 타겟팅은 없다. 그래서
 * "우리 타겟이 실수요층과 맞는가"를 대시보드에서 확인할 방법이 없었다.
 * 네이버 데이터랩·검색광고로 확인한 여성시계 실수요는 40~50대인데,
 * 메타 광고가 몇 살을 잡고 있는지 아무도 몰랐다.
 *
 * GET /api/mads/targeting   (헤더 x-agent-token = PAULWISE_MCP_TOKEN)
 *   → { ok, adsets: [{ id, name, campaign, status, ageMin, ageMax, genders, dailyBudget }] }
 */
import { type NextRequest } from "next/server";
import { getMetaTokenServer } from "@/lib/metaTokenStore";

export const dynamic = "force-dynamic";

const V = "v22.0";
const ACCT = (process.env.META_AD_ACCOUNT_ID || "act_3644222039208759").replace(/^(act_)?/, "act_");

/** Meta genders: [1]=남성 [2]=여성, 빈 배열/없음 = 전체. */
function genderLabel(g?: number[] | null): string {
  if (!g || !g.length) return "전체";
  return g.map((x) => (x === 1 ? "남성" : x === 2 ? "여성" : String(x))).join(",");
}

interface AdSetRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  targeting?: { age_min?: number; age_max?: number; genders?: number[] };
  campaign?: { name?: string; effective_status?: string };
}

export async function GET(req: NextRequest) {
  if (req.headers.get("x-agent-token") !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "메타 토큰 없음" }, { status: 500 });

  const qs = new URLSearchParams({
    access_token: token,
    fields: "id,name,status,effective_status,daily_budget,targeting{age_min,age_max,genders},campaign{name,effective_status}",
    limit: "200",
  });
  const res = await fetch(`https://graph.facebook.com/${V}/${ACCT}/adsets?${qs}`, { cache: "no-store" });
  const body = (await res.json()) as { data?: AdSetRow[]; error?: unknown };
  if (!res.ok) return Response.json({ ok: false, error: body.error }, { status: 502 });

  const adsets = (body.data ?? []).map((s) => ({
    id: s.id,
    name: s.name ?? "",
    campaign: s.campaign?.name ?? null,
    status: s.effective_status ?? s.status ?? null,
    ageMin: s.targeting?.age_min ?? null,
    ageMax: s.targeting?.age_max ?? null,
    genders: genderLabel(s.targeting?.genders),
    dailyBudget: s.daily_budget ? parseInt(s.daily_budget, 10) : null,
  }));
  return Response.json({ ok: true, count: adsets.length, adsets });
}
