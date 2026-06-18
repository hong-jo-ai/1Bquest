import { getDashboardData } from "@/lib/cafe24Data";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const mall: MallId = req.nextUrl.searchParams.get("brand") === "harriot" ? "harriot" : "paulvice";
  let token = await getValidC24Token(mall);
  if (!token) token = await getAccessTokenFromStore(mall);

  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  try {
    const data = await getDashboardData(token, mall);
    return NextResponse.json(data);
  } catch (e: any) {
    console.error("[Cafe24] data fetch error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
