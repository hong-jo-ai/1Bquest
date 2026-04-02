import { cookies } from "next/headers";
import { extendMetaToken } from "@/lib/metaClient";

export async function POST() {
  const cookieStore = await cookies();
  const current = cookieStore.get("meta_at")?.value;
  if (!current) {
    return Response.json({ error: "토큰 없음" }, { status: 401 });
  }

  try {
    const extended = await extendMetaToken(current);
    cookieStore.set("meta_at", extended.access_token, {
      httpOnly: true,
      secure:   true,
      maxAge:   55 * 24 * 60 * 60,
      path:     "/",
      sameSite: "lax",
    });
    return Response.json({ ok: true, expiresIn: extended.expires_in });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
