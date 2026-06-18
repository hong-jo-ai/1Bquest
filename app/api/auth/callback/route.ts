import { exchangeCode, mallFromState } from "@/lib/cafe24Client";
import { saveInitialCafe24Token } from "@/lib/cafe24Auth";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  // OAuth state 로 어느 몰(폴바이스/해리엇) 콜백인지 식별
  const mall = mallFromState(req.nextUrl.searchParams.get("state"));

  if (error || !code) {
    redirect(`/?error=${error ?? "no_code"}`);
  }

  try {
    const token = await exchangeCode(code!, mall);
    await saveInitialCafe24Token(token, mall);
    redirect(`/?connected=${mall}`);
  } catch (e) {
    console.error("[Cafe24 OAuth] callback error:", e);
    redirect("/?error=auth_failed");
  }
}
