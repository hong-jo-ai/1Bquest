import { cookies } from "next/headers";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";

const THREADS_BASE = "https://graph.threads.net/v1.0";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("threads_at")?.value
    || await getThreadsTokenFromStore()
    || process.env.THREADS_ACCESS_TOKEN
    || null;

  if (!token) {
    return Response.json({ connected: false });
  }

  // 토큰 유효성 실제 확인
  try {
    const res = await fetch(
      `${THREADS_BASE}/me?fields=id,username&access_token=${token}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return Response.json({ connected: false });
    }
    const me = await res.json();
    return Response.json({ connected: true, username: me.username });
  } catch {
    return Response.json({ connected: false });
  }
}
