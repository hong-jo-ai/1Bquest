import { NextRequest, NextResponse } from "next/server";
import { loadRevenueHistory } from "@/lib/finance/revenueHistory";
import type { Brand } from "@/lib/multiChannelData";

export const dynamic = "force-dynamic";

type Granularity = "day" | "week" | "month";

/**
 * GET /api/revenue-trend?brand=paulvice&granularity=day&from=2026-04-01&to=2026-05-01
 *
 * 응답:
 *   { ok: true, points: [{ date: "2026-04-01", revenue: 1234567 }, ...] }
 *
 *   - granularity=day:   date = "YYYY-MM-DD" (해당일)
 *   - granularity=week:  date = 그 주 월요일 "YYYY-MM-DD"
 *   - granularity=month: date = "YYYY-MM-01"
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brand = sp.get("brand") as Brand | null;
  const granularity = (sp.get("granularity") ?? "day") as Granularity;
  const from = sp.get("from"); // "YYYY-MM-DD"
  const to   = sp.get("to");   // "YYYY-MM-DD"

  if (!brand || (brand !== "paulvice" && brand !== "harriot")) {
    return NextResponse.json({ ok: false, error: "invalid brand" }, { status: 400 });
  }
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ ok: false, error: "invalid from/to" }, { status: 400 });
  }
  if (granularity !== "day" && granularity !== "week" && granularity !== "month") {
    return NextResponse.json({ ok: false, error: "invalid granularity" }, { status: 400 });
  }

  const history = await loadRevenueHistory(brand);

  // 기간 내 일별 entries 만 추리기
  const inRange: Array<{ date: string; total: number }> = [];
  for (const [date, day] of Object.entries(history.days)) {
    if (date < from || date > to) continue;
    inRange.push({ date, total: day.total });
  }
  inRange.sort((a, b) => a.date.localeCompare(b.date));

  // granularity 적용
  const buckets = new Map<string, number>();
  for (const { date, total } of inRange) {
    const key = bucketKey(date, granularity);
    buckets.set(key, (buckets.get(key) ?? 0) + total);
  }

  const points = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, revenue]) => ({ date, revenue }));

  return NextResponse.json({ ok: true, points, granularity, brand, from, to });
}

/** 일자(YYYY-MM-DD) → granularity 별 bucket key */
function bucketKey(date: string, g: Granularity): string {
  if (g === "day")   return date;
  if (g === "month") return date.slice(0, 7) + "-01";
  // week → 그 주 월요일 (KST 기준이지만 input 자체가 KST date 라 그대로 처리)
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=일
  const offset = dow === 0 ? 6 : dow - 1; // 월요일까지의 거리
  dt.setUTCDate(dt.getUTCDate() - offset);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
