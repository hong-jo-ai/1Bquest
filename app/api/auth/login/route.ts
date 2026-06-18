import { getAuthUrl, type MallId } from "@/lib/cafe24Client";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

// /api/auth/login            → 폴바이스 카페24 연결
// /api/auth/login?mall=harriot → 해리엇 카페24 연결
export async function GET(req: NextRequest) {
  const mall: MallId = req.nextUrl.searchParams.get("mall") === "harriot" ? "harriot" : "paulvice";
  redirect(getAuthUrl(mall));
}
