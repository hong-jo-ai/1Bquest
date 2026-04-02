import { cookies } from "next/headers";
import { META_BASE } from "@/lib/metaClient";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("meta_at")?.value;

  const result: Record<string, any> = {
    hasToken: !!token,
    tokenPrefix: token ? token.slice(0, 20) + "..." : null,
    apiVersion: META_BASE,
    envVars: {
      hasAppId: !!process.env.META_APP_ID,
      hasAppSecret: !!process.env.META_APP_SECRET,
      redirectUri: process.env.META_REDIRECT_URI ?? "(not set)",
      adAccountId: process.env.META_AD_ACCOUNT_ID ?? "(not set)",
    },
  };

  if (!token) {
    return Response.json({ ...result, error: "meta_at 쿠키 없음 — 재연결 필요" });
  }

  // 1. 토큰 유효성 확인
  try {
    const qs = new URLSearchParams({ access_token: token, fields: "id,name" });
    const res = await fetch(`${META_BASE}/me?${qs}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      result.tokenCheck = { ok: false, error: json.error?.message ?? JSON.stringify(json) };
    } else {
      result.tokenCheck = { ok: true, userId: json.id, name: json.name };
    }
  } catch (e: any) {
    result.tokenCheck = { ok: false, error: e.message };
  }

  // 2. 광고 계정 목록
  try {
    const qs = new URLSearchParams({ access_token: token, fields: "id,name,account_status", limit: "5" });
    const res = await fetch(`${META_BASE}/me/adaccounts?${qs}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      result.adAccounts = { ok: false, error: json.error?.message ?? JSON.stringify(json) };
    } else {
      result.adAccounts = {
        ok: true,
        count: (json.data ?? []).length,
        accounts: (json.data ?? []).map((a: any) => ({
          id: a.id, name: a.name, status: a.account_status,
        })),
      };
    }
  } catch (e: any) {
    result.adAccounts = { ok: false, error: e.message };
  }

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
