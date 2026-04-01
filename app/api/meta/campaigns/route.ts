import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { fetchCampaigns, PERIOD_META_PRESET, type Period } from "@/lib/metaData";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("meta_at")?.value;
  if (!token) {
    return Response.json({ error: "인증 필요" }, { status: 401 });
  }

  const accountId = req.nextUrl.searchParams.get("accountId");
  const period    = (req.nextUrl.searchParams.get("period") ?? "month") as Period;

  if (!accountId) {
    return Response.json({ error: "accountId 파라미터가 필요합니다" }, { status: 400 });
  }

  const datePreset = PERIOD_META_PRESET[period] ?? "this_month";

  try {
    const campaigns = await fetchCampaigns(token, accountId, datePreset);
    return Response.json({ campaigns });
  } catch (e: any) {
    return Response.json({ error: e.message ?? "캠페인 조회 실패" }, { status: 500 });
  }
}
