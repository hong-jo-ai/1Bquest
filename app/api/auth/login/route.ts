import { getAuthUrl } from "@/lib/cafe24Client";
import { redirect } from "next/navigation";

export async function GET() {
  redirect(getAuthUrl());
}
