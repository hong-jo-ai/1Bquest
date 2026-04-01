import { getMetaAuthUrl } from "@/lib/metaClient";
import { redirect } from "next/navigation";

export async function GET() {
  redirect(getMetaAuthUrl());
}
