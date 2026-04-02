import { cookies } from "next/headers";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { cafe24Get } from "@/lib/cafe24Client";
import { refreshGoogleToken } from "@/lib/ga4Client";
import { META_BASE } from "@/lib/metaClient";

function kstNow() { return new Date(Date.now() + 9 * 3_600_000); }
function kstStr(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET() {
  const cookieStore = await cookies();
  const metaToken = cookieStore.get("meta_at")?.value ?? null;
  let   gaToken   = cookieStore.get("ga_at")?.value  ?? null;
  const gaRt      = cookieStore.get("ga_rt")?.value  ?? null;
  const ga4PropId = cookieStore.get("ga4_prop")?.value ?? process.env.GA4_PROPERTY_ID ?? "";

  const result: Record<string, any> = {
    cafe24:  { connected: false, detail: "" },
    meta:    { connected: false, detail: "" },
    google:  { tokenPresent: false, propertyId: ga4PropId || "미설정", apiOk: false, detail: "" },
  };

  // ── Cafe24 (토큰 자동 갱신 포함) ────────────────────────────────────────
  const c24Token = await getValidC24Token();
  if (c24Token) {
    try {
      const now = kstNow();
      const today = kstStr(now);
      const yesterday = kstStr(new Date(now.getTime() - 86_400_000));
      const data = await cafe24Get(
        `/api/v2/admin/orders?start_date=${yesterday}&end_date=${today}&limit=1`,
        c24Token
      );
      result.cafe24.connected = true;
      result.cafe24.detail    = `정상 | 오늘+어제 주문 샘플 조회 성공 (${(data.orders ?? []).length}건)`;
    } catch (e: any) {
      result.cafe24.detail = `API 오류: ${e.message}`;
    }
  } else {
    result.cafe24.detail = "토큰 없음 — 카페24 재연결 필요";
  }

  // ── Meta ────────────────────────────────────────────────────────────────
  if (metaToken) {
    try {
      const qs  = new URLSearchParams({ access_token: metaToken, fields: "id,name" });
      const res = await fetch(`${META_BASE}/me?${qs}`, { cache: "no-store" });
      const json = await res.json();
      result.meta.connected = res.ok && !!json.id;
      result.meta.detail    = res.ok
        ? `계정: ${json.name ?? json.id}`
        : json.error?.message ?? `HTTP ${res.status}`;
    } catch (e: any) {
      result.meta.detail = e.message;
    }
  } else {
    result.meta.detail = "토큰 없음";
  }

  // ── Google / GA4 ────────────────────────────────────────────────────────
  if (!gaToken && gaRt) {
    try {
      gaToken = await refreshGoogleToken(gaRt);
    } catch (e: any) {
      result.google.detail = `토큰 갱신 실패: ${e.message}`;
    }
  }

  result.google.tokenPresent = !!gaToken;

  if (!gaToken) {
    result.google.detail = result.google.detail || "Google 로그인 필요";
  } else if (!ga4PropId) {
    result.google.detail = "토큰 있음 — Property ID 미설정";
  } else {
    try {
      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${ga4PropId}:runReport`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${gaToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
            metrics: [{ name: "activeUsers" }],
          }),
          cache: "no-store",
        }
      );
      const json = await res.json();
      if (res.ok) {
        const users = json.rows?.[0]?.metricValues?.[0]?.value ?? "0";
        result.google.apiOk  = true;
        result.google.detail = `✓ 정상 연결 | 최근 7일 방문자: ${Number(users).toLocaleString("ko-KR")}명 | Property: ${ga4PropId}`;
      } else {
        result.google.detail = `API 오류: ${json.error?.message ?? JSON.stringify(json)}`;
      }
    } catch (e: any) {
      result.google.detail = `요청 실패: ${e.message}`;
    }
  }

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
