import { getThreadsAuthUrl } from "@/lib/threadsClient";
import { redirect } from "next/navigation";

export async function GET() {
  redirect(getThreadsAuthUrl());
}
