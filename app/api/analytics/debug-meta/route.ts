import { META_BASE } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";

function kstNow() { return new Date(Date.now() + 9 * 3_600_000); }
function kstStr(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET() {
  const metaToken = await getMetaTokenServer();
  if (!metaToken) return Response.json({ error: "Meta 토큰 없음" }, { status: 401 });

  const now     = kstNow();
  const today   = kstStr(now);
  const start30 = kstStr(new Date(now.getTime() - 29 * 86_400_000));
  const start7  = kstStr(new Date(now.getTime() -  6 * 86_400_000));

  // 광고 계정 ID 가져오기
  let accountId = process.env.META_AD_ACCOUNT_ID ?? "";
  if (!accountId) {
    try {
      const qs  = new URLSearchParams({ access_token: metaToken, fields: "id,account_status", limit: "5" });
      const res = await fetch(`${META_BASE}/me/adaccounts?${qs}`, { cache: "no-store" });
      const json = await res.json();
      const accounts: any[] = json.data ?? [];
      const active = accounts.find((a) => a.account_status === 1) ?? accounts[0];
      accountId = active?.id ?? "";
    } catch (e: any) {
      return Response.json({ error: `계정 조회 실패: ${e.message}` }, { status: 500 });
    }
  }
  if (!accountId) return Response.json({ error: "광고 계정 없음" }, { status: 500 });

  const results: Record<string, any> = {
    requestDates: { start30, start7, today },
    accountId,
  };

  // 1. 최근 7일 일별 데이터
  try {
    const qs = new URLSearchParams({
      access_token:   metaToken,
      fields:         "date_start,date_stop,impressions,reach,clicks,spend",
      time_range:     JSON.stringify({ since: start7, until: today }),
      time_increment: "1",
      level:          "account",
    });
    const res  = await fetch(`${META_BASE}/${accountId}/insights?${qs}`, { cache: "no-store" });
    const json = await res.json();
    results.last7Days = {
      ok:    res.ok,
      count: (json.data ?? []).length,
      rows:  (json.data ?? []).map((d: any) => ({
        date:        d.date_start,
        impressions: d.impressions,
        clicks:      d.clicks,
        spend:       d.spend,
      })),
      error: json.error?.message,
    };
  } catch (e: any) {
    results.last7Days = { error: e.message };
  }

  // 2. 최근 30일 일별 (날짜만 확인)
  try {
    const qs = new URLSearchParams({
      access_token:   metaToken,
      fields:         "date_start,impressions,spend",
      time_range:     JSON.stringify({ since: start30, until: today }),
      time_increment: "1",
      level:          "account",
    });
    const res  = await fetch(`${META_BASE}/${accountId}/insights?${qs}`, { cache: "no-store" });
    const json = await res.json();
    const rows = json.data ?? [];
    results.last30Days = {
      ok:        res.ok,
      totalRows: rows.length,
      firstDate: rows[0]?.date_start,
      lastDate:  rows[rows.length - 1]?.date_start,
      missingDates: (() => {
        // 어떤 날짜가 빠졌는지 확인
        const returned = new Set(rows.map((r: any) => r.date_start));
        const missing = [];
        for (let i = 0; i < 30; i++) {
          const d = kstStr(new Date(now.getTime() - (29 - i) * 86_400_000));
          if (!returned.has(d)) missing.push(d);
        }
        return missing;
      })(),
      error: json.error?.message,
    };
  } catch (e: any) {
    results.last30Days = { error: e.message };
  }

  // 3. date_preset "last_7d" 로도 확인
  try {
    const qs = new URLSearchParams({
      access_token:   metaToken,
      fields:         "date_start,date_stop,impressions,spend",
      date_preset:    "last_7d",
      time_increment: "1",
      level:          "account",
    });
    const res  = await fetch(`${META_BASE}/${accountId}/insights?${qs}`, { cache: "no-store" });
    const json = await res.json();
    results.preset_last7d = {
      ok:   res.ok,
      rows: (json.data ?? []).map((d: any) => ({ date: d.date_start, impressions: d.impressions, spend: d.spend })),
      error: json.error?.message,
    };
  } catch (e: any) {
    results.preset_last7d = { error: e.message };
  }

  return Response.json(results, { headers: { "Cache-Control": "no-store" } });
}
