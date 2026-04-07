import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { exchangeThreadsCode, getLongLivedThreadsToken } from "@/lib/threadsClient";
import { saveThreadsToken } from "@/lib/threadsTokenStore";
import type { BrandId } from "@/lib/threadsBrands";

const VALID_BRANDS: BrandId[] = ["paulvice", "harriot", "hongsungjo"];

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const state = req.nextUrl.searchParams.get("state") ?? "paulvice";
  const brand = (VALID_BRANDS.includes(state as BrandId) ? state : "paulvice") as BrandId;

  if (error || !code) {
    redirect(`/tools/threads?error=${encodeURIComponent(error ?? "cancelled")}`);
  }

  try {
    const shortToken = await exchangeThreadsCode(code, brand);

    let finalToken = shortToken.access_token;
    try {
      const longToken = await getLongLivedThreadsToken(shortToken.access_token, brand);
      finalToken = longToken.access_token;
      console.log(`[Threads OAuth] ${brand} 장기 토큰 발급 성공`);
    } catch (e: any) {
      console.warn(`[Threads OAuth] ${brand} 장기 토큰 실패, 단기 토큰 사용:`, e.message);
    }

    // Supabase에 브랜드별 토큰 저장
    await saveThreadsToken(finalToken, brand).catch((e) =>
      console.error(`[Threads OAuth] ${brand} token store failed:`, e)
    );

    // 쿠키에도 저장 (백업)
    const cookieStore = await cookies();
    cookieStore.set(`threads_at_${brand}`, finalToken, {
      httpOnly: true,
      secure: true,
      maxAge: 55 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
    });

    redirect("/tools/threads");
  } catch (e: any) {
    if (e.message === "NEXT_REDIRECT") throw e;
    console.error(`[Threads OAuth] ${brand} callback error:`, e);
    redirect(`/tools/threads?error=${encodeURIComponent(e.message)}`);
  }
}
