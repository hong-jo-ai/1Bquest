/**
 * 앱 세션 로그아웃 — paulwise_session 쿠키 삭제 후 /login 으로 리다이렉트.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/appAuth";

export async function GET() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function POST() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
