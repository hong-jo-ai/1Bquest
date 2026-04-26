import { cookies } from "next/headers";
import { metaGet } from "@/lib/metaClient";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

interface InsightRow {
  date_start: string; // YYYY-MM-DD
  spend?: string;
}

function kstDateStr(offsetDays: number = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * 최근 N일치 메타 광고비를 일별로 가져온다 (전체 광고 계정 합산).
 *
 * 응답: { ok, daily: [{ date, spend }, ...], accounts, accountErrors }
 *      - ok=false: meta_at 쿠키 없음 또는 accounts 조회 실패
 *      - ok=true & daily=[]: 연결은 됐지만 광고비 0 또는 계정 없음
 */
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("meta_at")?.value;
  if (!token) {
    return Response.json({ ok: false, error: "Meta 미연결 (meta_at 쿠키 없음)" });
  }

  const days = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("days") ?? "60", 10), 1),
    90
  );
  const until = kstDateStr(0);
  const since = kstDateStr(-(days - 1));

  try {
    // 모든 광고 계정 조회
    const accountsRes = (await metaGet("/me/adaccounts", token, {
      fields: "id,name,currency",
      limit: "20",
    })) as { data?: Array<{ id: string; name: string }> };

    const accounts = accountsRes.data ?? [];
    if (accounts.length === 0) {
      return Response.json({
        ok: true,
        daily: [],
        accounts: 0,
        warning: "Meta에 광고 계정이 없거나 토큰에 접근 권한 없음",
      });
    }

    // 각 계정의 일별 spend 조회 → 날짜별 합산
    const dailyMap = new Map<string, number>();
    const accountErrors: Array<{ accountId: string; name: string; error: string }> = [];

    await Promise.all(
      accounts.map(async (acc) => {
        try {
          const ins = (await metaGet(`/${acc.id}/insights`, token, {
            fields: "spend",
            time_increment: "1",
            // time_range가 date_preset보다 안정적 (last_60d 같은 무효 프리셋 회피)
            time_range: JSON.stringify({ since, until }),
            level: "account",
          })) as { data?: InsightRow[] };

          for (const row of ins.data ?? []) {
            const cur = dailyMap.get(row.date_start) ?? 0;
            dailyMap.set(row.date_start, cur + parseFloat(row.spend ?? "0"));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[meta-spend] account ${acc.id} 실패:`, msg);
          accountErrors.push({ accountId: acc.id, name: acc.name, error: msg });
        }
      })
    );

    const daily = Array.from(dailyMap.entries())
      .map(([date, spend]) => ({ date, spend: Math.round(spend) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return Response.json({
      ok: true,
      daily,
      accounts: accounts.length,
      accountNames: accounts.map((a) => a.name),
      accountErrors: accountErrors.length > 0 ? accountErrors : undefined,
      since,
      until,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
