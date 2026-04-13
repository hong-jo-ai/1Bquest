import { type NextRequest } from "next/server";
import { getCsSupabase } from "@/lib/cs/store";
import type { CsBrandId } from "@/lib/cs/types";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

interface UserInfo {
  email: string;
  sub: string;
}

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
}

function renderDebugPage(steps: Step[], success: boolean, brand?: string) {
  const ok = success;
  const headerColor = ok ? "#059669" : "#dc2626";
  const headerText = ok ? "✓ Gmail 연결 성공" : "✗ Gmail 연결 실패";
  const stepsHtml = steps
    .map(
      (s) => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #e5e7eb">
      <span style="font-weight:bold;color:${s.ok ? "#059669" : "#dc2626"};font-size:14px;flex-shrink:0">${s.ok ? "✓" : "✗"}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:#111827">${escapeHtml(s.name)}</div>
        ${s.detail ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;word-break:break-word">${escapeHtml(s.detail)}</div>` : ""}
      </div>
    </div>
  `
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>Gmail 연결 결과</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #111827; background: #f9fafb; }
  h1 { color: ${headerColor}; font-size: 24px; margin-bottom: 4px; }
  .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-top: 16px; }
  a.btn { display: inline-block; background: #7c3aed; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; margin-top: 16px; }
  a.btn.gray { background: #e5e7eb; color: #111827; margin-left: 8px; }
</style>
</head>
<body>
  <h1>${headerText}</h1>
  ${brand ? `<div style="color:#6b7280;font-size:14px">브랜드: ${escapeHtml(brand)}</div>` : ""}
  <div class="card">
    ${stepsHtml}
  </div>
  <a class="btn" href="/inbox/setup">설정 페이지로</a>
  <a class="btn gray" href="/inbox">인박스로</a>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: NextRequest) {
  const steps: Step[] = [];
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const oauthError = req.nextUrl.searchParams.get("error");

  // Step 1: state 파싱
  const brandMatch = state.match(/^cs_gmail_(paulvice|harriot)$/);
  if (!brandMatch) {
    steps.push({ name: "state 파싱", ok: false, detail: `state=${state || "(없음)"}` });
    return renderDebugPage(steps, false);
  }
  const brand = brandMatch[1] as CsBrandId;
  steps.push({ name: "state 파싱", ok: true, detail: `brand=${brand}` });

  // Step 2: code 확인
  if (oauthError || !code) {
    steps.push({
      name: "OAuth code 수신",
      ok: false,
      detail: oauthError ?? "code 없음",
    });
    return renderDebugPage(steps, false, brand);
  }
  steps.push({ name: "OAuth code 수신", ok: true });

  // Step 3: 토큰 교환
  let token: TokenResponse;
  try {
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/cs/auth/gmail/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      steps.push({ name: "토큰 교환", ok: false, detail: `${tokenRes.status}: ${text}` });
      return renderDebugPage(steps, false, brand);
    }
    token = (await tokenRes.json()) as TokenResponse;
    steps.push({
      name: "토큰 교환",
      ok: true,
      detail: `access_token=${token.access_token?.slice(0, 20)}..., refresh_token=${token.refresh_token ? "있음" : "없음"}`,
    });
  } catch (e) {
    steps.push({
      name: "토큰 교환",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return renderDebugPage(steps, false, brand);
  }

  // Step 4: refresh_token 확보 (없으면 기존 row에서 재사용)
  let refreshToken = token.refresh_token;
  if (!refreshToken) {
    try {
      const db = getCsSupabase();
      const { data: existing } = await db
        .from("cs_accounts")
        .select("credentials")
        .eq("brand", brand)
        .eq("channel", "gmail")
        .maybeSingle();
      const existingToken =
        (existing?.credentials as Record<string, unknown> | null)?.refresh_token;
      if (typeof existingToken === "string" && existingToken) {
        refreshToken = existingToken;
        steps.push({
          name: "refresh_token 확보",
          ok: true,
          detail: "Google이 새 refresh_token을 안 줘서 기존 DB 값 재사용",
        });
      } else {
        steps.push({
          name: "refresh_token 확보",
          ok: false,
          detail:
            "Google이 refresh_token을 반환하지 않았고 DB에도 없음. https://myaccount.google.com/permissions 에서 이 앱을 제거한 후 재시도하세요.",
        });
        return renderDebugPage(steps, false, brand);
      }
    } catch (e) {
      steps.push({
        name: "refresh_token 확보",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
      return renderDebugPage(steps, false, brand);
    }
  } else {
    steps.push({ name: "refresh_token 확보", ok: true, detail: "Google에서 새로 받음" });
  }

  // Step 5: userinfo
  let user: UserInfo;
  try {
    const userRes = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${token.access_token}` } }
    );
    if (!userRes.ok) {
      const text = await userRes.text();
      steps.push({ name: "userinfo 조회", ok: false, detail: text });
      return renderDebugPage(steps, false, brand);
    }
    user = (await userRes.json()) as UserInfo;
    steps.push({ name: "userinfo 조회", ok: true, detail: user.email });
  } catch (e) {
    steps.push({
      name: "userinfo 조회",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return renderDebugPage(steps, false, brand);
  }

  // Step 6: 이메일 매칭
  const expected: Record<CsBrandId, string> = {
    paulvice: "plvekorea@gmail.com",
    harriot: "harriotwatches@gmail.com",
  };
  if (user.email.toLowerCase() !== expected[brand]) {
    steps.push({
      name: "이메일 매칭",
      ok: false,
      detail: `기대=${expected[brand]}, 실제=${user.email}`,
    });
    return renderDebugPage(steps, false, brand);
  }
  steps.push({ name: "이메일 매칭", ok: true, detail: user.email });

  // Step 7: cs_accounts upsert
  let upsertedId: string | null = null;
  try {
    const db = getCsSupabase();
    const { data, error: dbErr } = await db
      .from("cs_accounts")
      .upsert(
        {
          brand,
          channel: "gmail",
          display_name: user.email,
          credentials: {
            refresh_token: refreshToken,
            last_history_id: null,
          },
          status: "active",
          error_message: null,
          last_synced_at: null,
        },
        { onConflict: "brand,channel,display_name" }
      )
      .select("id")
      .single();
    if (dbErr) {
      steps.push({
        name: "cs_accounts upsert",
        ok: false,
        detail: `${dbErr.code ?? ""}: ${dbErr.message}`,
      });
      return renderDebugPage(steps, false, brand);
    }
    upsertedId = data?.id ?? null;
    steps.push({
      name: "cs_accounts upsert",
      ok: true,
      detail: `id=${upsertedId}`,
    });
  } catch (e) {
    steps.push({
      name: "cs_accounts upsert",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return renderDebugPage(steps, false, brand);
  }

  // Step 8: 검증 SELECT
  try {
    const db = getCsSupabase();
    const { data, error } = await db
      .from("cs_accounts")
      .select("id, brand, channel, display_name, status")
      .eq("id", upsertedId!)
      .single();
    if (error || !data) {
      steps.push({
        name: "저장 검증",
        ok: false,
        detail: error?.message ?? "row 조회 실패",
      });
      return renderDebugPage(steps, false, brand);
    }
    steps.push({
      name: "저장 검증",
      ok: true,
      detail: `${data.brand}/${data.channel}/${data.display_name} (${data.status})`,
    });
  } catch (e) {
    steps.push({
      name: "저장 검증",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return renderDebugPage(steps, false, brand);
  }

  return renderDebugPage(steps, true, brand);
}
