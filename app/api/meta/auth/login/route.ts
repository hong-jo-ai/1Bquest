import { getMetaAuthUrl } from "@/lib/metaClient";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? undefined;
  redirect(getMetaAuthUrl(returnTo));
}
