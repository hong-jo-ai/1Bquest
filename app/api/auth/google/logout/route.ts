import { cookies } from "next/headers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

export async function GET() {
  const cookieStore = await cookies();
  cookieStore.delete("ga_at");
  cookieStore.delete("ga_rt");
  return Response.redirect(`${APP_URL}/analytics`);
}
