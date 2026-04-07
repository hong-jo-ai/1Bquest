import { getThreadsAuthUrl } from "@/lib/threadsClient";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand") ?? "paulvice";
  redirect(getThreadsAuthUrl(brand));
}
