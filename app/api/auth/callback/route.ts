import { exchangeCode } from "@/lib/cafe24Client";
import { saveInitialCafe24Token } from "@/lib/cafe24Auth";
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
    // 쿠키 + Supabase 동시 저장 (SSOT 일관성)
    await saveInitialCafe24Token(token);
    redirect("/");
  } catch (e) {
    console.error("[Cafe24 OAuth] callback error:", e);
    redirect("/?error=auth_failed");
  }
}
