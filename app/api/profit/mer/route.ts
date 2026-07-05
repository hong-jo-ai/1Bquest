/** 브랜드별 자사몰 MER 조회. Bearer CRON_SECRET 또는 세션 인증. */
import { NextRequest } from "next/server";
import { computeAllBrandMer } from "@/lib/profit/mer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const bearerOk = secret && auth === `Bearer ${secret}`;
  // 세션 게이트는 미들웨어가 처리 — 여기 도달하면 통과. bearer는 크론/테스트용.
  const days = Number(req.nextUrl.searchParams.get("days") ?? "7") || 7;
  const rows = await computeAllBrandMer(days);
  return Response.json({ ok: true, days, bearerOk, brands: rows });
}
