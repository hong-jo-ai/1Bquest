import { cookies } from "next/headers";
import { extendMetaToken } from "@/lib/metaClient";
import { getMetaTokenServer, saveMetaToken } from "@/lib/metaTokenStore";

export async function POST() {
  const current = await getMetaTokenServer();
  if (!current) {
    return Response.json({ error: "토큰 없음" }, { status: 401 });
  }

  try {
    const extended = await extendMetaToken(current);
    const cookieStore = await cookies();
    cookieStore.set("meta_at", extended.access_token, {
      httpOnly: true,
      secure:   true,
      maxAge:   55 * 24 * 60 * 60,
      path:     "/",
      sameSite: "lax",
    });
    await saveMetaToken(extended.access_token).catch((e) =>
      console.error("[Meta refresh] store save failed:", e)
    );
    return Response.json({ ok: true, expiresIn: extended.expires_in });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
