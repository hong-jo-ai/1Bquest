import { type NextRequest } from "next/server";
import { getCsSupabase } from "@/lib/cs/store";
import {
  exchangeCodeForToken,
  getIgBusinessAccount,
  getLongLivedUserToken,
  listManagedPages,
  EXPECTED_IG_USERNAME,
  EXPECTED_IG_USERNAMES,
} from "@/lib/cs/instagramClient";
import type { CsBrandId } from "@/lib/cs/types";

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDebugPage(steps: Step[], success: boolean, brand?: string) {
  const headerColor = success ? "#059669" : "#dc2626";
  const headerText = success ? "✓ Instagram DM 연결 성공" : "✗ Instagram DM 연결 실패";
  const stepsHtml = steps
    .map(
      (s) => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #e5e7eb">
      <span style="font-weight:bold;color:${s.ok ? "#059669" : "#dc2626"};font-size:14px;flex-shrink:0">${s.ok ? "✓" : "✗"}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600;color:#111827">${escapeHtml(s.name)}</div>
        ${s.detail ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;word-break:break-word">${escapeHtml(s.detail)}</div>` : ""}
      </div>
    </div>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>IG DM 연결 결과</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#111827;background:#f9fafb}
h1{color:${headerColor};font-size:24px;margin-bottom:4px}
.card{background:white;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-top:16px}
a.btn{display:inline-block;background:#7c3aed;color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;margin-top:16px}
a.btn.gray{background:#e5e7eb;color:#111827;margin-left:8px}
</style></head><body>
<h1>${headerText}</h1>
${brand ? `<div style="color:#6b7280;font-size:14px">브랜드: ${escapeHtml(brand)}</div>` : ""}
<div class="card">${stepsHtml}</div>
<a class="btn" href="/inbox/setup">설정 페이지로</a>
<a class="btn gray" href="/inbox">인박스로</a>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const steps: Step[] = [];
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const err = req.nextUrl.searchParams.get("error");

  const m = state.match(/^cs_ig_(paulvice|harriot)$/);
  if (!m) {
    steps.push({ name: "state 파싱", ok: false, detail: `state=${state}` });
    return renderDebugPage(steps, false);
  }
  const brand = m[1] as CsBrandId;
  steps.push({ name: "state 파싱", ok: true, detail: `brand=${brand}` });

  if (err || !code) {
    steps.push({
      name: "OAuth code 수신",
      ok: false,
      detail: err ?? "code 없음",
    });
    return renderDebugPage(steps, false, brand);
  }
  steps.push({ name: "OAuth code 수신", ok: true });

  // 1. 코드 → 단기 토큰
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/cs/auth/instagram/callback`;
  let shortToken: string;
  try {
    shortToken = await exchangeCodeForToken(brand, code, redirectUri);
    steps.push({
      name: "단기 토큰 교환",
      ok: true,
      detail: `${shortToken.slice(0, 20)}...`,
    });
  } catch (e) {
    steps.push({
      name: "단기 토큰 교환",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return renderDebugPage(steps, false, brand);
  }

  // 2. 장기 토큰 교환
  let longToken: string;
  try {
    longToken = await getLongLivedUserToken(brand, shortToken);
    steps.push({ name: "장기 토큰 교환 (60일)", ok: true });
  } catch (e) {
    steps.push({
      name: "장기 토큰 교환",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return renderDebugPage(steps, false, brand);
  }

  // 3. 페이지 목록 + IG 연결 확인
  let pages;
  try {
    pages = await listManagedPages(longToken);
    steps.push({
      name: "페이지 목록 조회",
      ok: pages.length > 0,
      detail: `${pages.length}개 페이지 발견: ${pages.map((p) => p.name).join(", ")}`,
    });
    if (pages.length === 0) return renderDebugPage(steps, false, brand);
  } catch (e) {
    steps.push({
      name: "페이지 목록 조회",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return renderDebugPage(steps, false, brand);
  }

  // 4. IG 비즈니스 계정이 연결된 페이지만 남김
  const pagesWithIg = pages.filter((p) => p.instagram_business_account?.id);
  if (pagesWithIg.length === 0) {
    steps.push({
      name: "IG 계정 연결된 페이지",
      ok: false,
      detail:
        "하나도 없음. Facebook 페이지에 IG 비즈니스 계정을 연결해야 합니다.",
    });
    return renderDebugPage(steps, false, brand);
  }
  steps.push({
    name: "IG 계정 연결된 페이지",
    ok: true,
    detail: `${pagesWithIg.length}개`,
  });

  // 5. 브랜드에 맞는 IG 계정 찾기 (username 매칭, 여러 후보 허용)
  const candidates = EXPECTED_IG_USERNAMES[brand].map((s) => s.toLowerCase());
  const fallbackUsername = EXPECTED_IG_USERNAME[brand];
  let matched: {
    pageId: string;
    pageName: string;
    pageAccessToken: string;
    igUserId: string;
    igUsername: string;
  } | null = null;
  const allFound: string[] = [];

  for (const p of pagesWithIg) {
    const igId = p.instagram_business_account!.id;
    try {
      const ig = await getIgBusinessAccount(igId, p.access_token);
      const uname = ig.username ?? "";
      allFound.push(`@${uname} (page: ${p.name})`);
      if (candidates.includes(uname.toLowerCase())) {
        matched = {
          pageId: p.id,
          pageName: p.name,
          pageAccessToken: p.access_token,
          igUserId: ig.id,
          igUsername: uname,
        };
      }
    } catch (e) {
      allFound.push(
        `(IG fetch 실패: ${e instanceof Error ? e.message : String(e)})`
      );
    }
  }

  if (!matched) {
    steps.push({
      name: "브랜드 IG 매칭",
      ok: false,
      detail: `기대: ${candidates.map((c) => "@" + c).join(" 또는 ")} / 실제로 찾은 계정: ${allFound.join(" | ") || "없음"}`,
    });
    return renderDebugPage(steps, false, brand);
  }

  void fallbackUsername; // unused 경고 방지

  steps.push({
    name: "브랜드 IG 매칭",
    ok: true,
    detail: `@${matched.igUsername} (페이지: ${matched.pageName})`,
  });

  // 6. cs_accounts upsert
  try {
    const db = getCsSupabase();
    const { error: dbErr } = await db.from("cs_accounts").upsert(
      {
        brand,
        channel: "ig_dm",
        display_name: `@${matched.igUsername}`,
        credentials: {
          page_id: matched.pageId,
          page_name: matched.pageName,
          page_access_token: matched.pageAccessToken,
          ig_user_id: matched.igUserId,
          ig_username: matched.igUsername,
          user_long_token: longToken,
        },
        status: "active",
        error_message: null,
        last_synced_at: null,
      },
      { onConflict: "brand,channel,display_name" }
    );
    if (dbErr) {
      steps.push({
        name: "cs_accounts 저장",
        ok: false,
        detail: dbErr.message,
      });
      return renderDebugPage(steps, false, brand);
    }
    steps.push({ name: "cs_accounts 저장", ok: true });
  } catch (e) {
    steps.push({
      name: "cs_accounts 저장",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return renderDebugPage(steps, false, brand);
  }

  return renderDebugPage(steps, true, brand);
}
