import { exchangeCode } from "@/lib/cafe24Client";
import { saveCafe24Token } from "@/lib/cafe24TokenStore";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    redirect(`/?error=${error ?? "no_code"}`);
  }

  try {
    const token = await exchangeCode(code!);
    const cookieStore = await cookies();

    cookieStore.set("c24_at", token.access_token, {
      httpOnly: true,
      secure: true,
      maxAge: token.expires_in ?? 7200,
      path: "/",
      sameSite: "lax",
    });
    cookieStore.set("c24_rt", token.refresh_token, {
      httpOnly: true,
      secure: true,
      maxAge: 60 * 60 * 24 * 14, // 14일
      path: "/",
      sameSite: "lax",
    });

    // Supabase에 refresh token 저장 (Cron 등 쿠키 없는 환경에서 사용)
    await saveCafe24Token(token.refresh_token).catch((e) =>
      console.error("[Cafe24 OAuth] token store failed:", e)
    );

    redirect("/");
  } catch (e) {
    console.error("[Cafe24 OAuth] callback error:", e);
    redirect("/?error=auth_failed");
  }
}
