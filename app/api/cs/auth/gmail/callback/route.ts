import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
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

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  const error = req.nextUrl.searchParams.get("error");

  const brandMatch = state.match(/^cs_gmail_(paulvice|harriot)$/);
  if (!brandMatch) {
    redirect(`/inbox/setup?error=${encodeURIComponent("invalid state")}`);
  }
  const brand = brandMatch![1] as CsBrandId;

  if (error || !code) {
    redirect(
      `/inbox/setup?error=${encodeURIComponent(error ?? "cancelled")}`
    );
  }

  try {
    const origin = req.nextUrl.origin;
    const redirectUri = `${origin}/api/cs/auth/gmail/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code!,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`token exchange 실패: ${await tokenRes.text()}`);
    }
    const token = (await tokenRes.json()) as TokenResponse;
    if (!token.refresh_token) {
      throw new Error(
        "refresh_token이 반환되지 않음 (prompt=consent로 재승인 필요)"
      );
    }

    // 이메일 주소 확인
    const userRes = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }
    );
    if (!userRes.ok) throw new Error("userinfo 조회 실패");
    const user = (await userRes.json()) as UserInfo;

    // 브랜드별 기대 이메일과 매칭되는지 확인 (실수 방지)
    const expected: Record<CsBrandId, string> = {
      paulvice: "plvekorea@gmail.com",
      harriot: "harriotwatches@gmail.com",
    };
    if (user.email.toLowerCase() !== expected[brand]) {
      redirect(
        `/inbox/setup?error=${encodeURIComponent(
          `브랜드(${brand}) 기대 이메일(${expected[brand]})과 다른 계정(${user.email})이 선택됨`
        )}`
      );
    }

    // cs_accounts에 upsert
    const db = getCsSupabase();
    const { error: dbErr } = await db.from("cs_accounts").upsert(
      {
        brand,
        channel: "gmail",
        display_name: user.email,
        credentials: {
          refresh_token: token.refresh_token,
          last_history_id: null,
        },
        status: "active",
        error_message: null,
        last_synced_at: null,
      },
      { onConflict: "brand,channel,display_name" }
    );
    if (dbErr) throw new Error(`cs_accounts upsert 실패: ${dbErr.message}`);

    redirect(`/inbox/setup?connected=${brand}`);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CS Gmail OAuth] callback error:", msg);
    redirect(`/inbox/setup?error=${encodeURIComponent(msg)}`);
  }
}
