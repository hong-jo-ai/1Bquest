import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { exchangeThreadsCode, getLongLivedThreadsToken } from "@/lib/threadsClient";
import { saveThreadsToken } from "@/lib/threadsTokenStore";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    redirect(`/tools/threads?error=${encodeURIComponent(error ?? "cancelled")}`);
  }

  try {
    // 1. 단기 토큰 교환
    const shortToken = await exchangeThreadsCode(code);

    // 2. 장기 토큰 교환 (60일)
    let finalToken = shortToken.access_token;
    try {
      const longToken = await getLongLivedThreadsToken(shortToken.access_token);
      finalToken = longToken.access_token;
      console.log("[Threads OAuth] 장기 토큰 발급 성공, expires_in:", longToken.expires_in);
    } catch (e: any) {
      console.warn("[Threads OAuth] 장기 토큰 교환 실패, 단기 토큰 사용:", e.message);
    }

    // 3. Supabase에 토큰 저장 (쿠키와 무관하게 영속)
    await saveThreadsToken(finalToken).catch((e) =>
      console.error("[Threads OAuth] token store failed:", e)
    );

    // 4. 쿠키에도 저장 시도 (백업)
    const cookieStore = await cookies();
    cookieStore.set("threads_at", finalToken, {
      httpOnly: true,
      secure: true,
      maxAge: 55 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
    });

    redirect("/tools/threads");
  } catch (e: any) {
    if (e.message === "NEXT_REDIRECT") throw e;
    console.error("[Threads OAuth] callback error:", e);
    redirect(`/tools/threads?error=${encodeURIComponent(e.message)}`);
  }
}
