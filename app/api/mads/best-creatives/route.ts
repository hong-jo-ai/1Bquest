import { findBestCreatives } from "@/lib/mads/bestCreatives";
import { getMetaTokenServer } from "@/lib/metaTokenStore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const token = await getMetaTokenServer();
  if (!token) {
    return Response.json({ ok: false, error: "Meta 미연결" }, { status: 401 });
  }
  try {
    const result = await findBestCreatives(token);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
