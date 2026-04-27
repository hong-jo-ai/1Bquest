import { listRecommendations } from "@/lib/mads/dbStore";
import type { RecStatus } from "@/lib/mads/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") ?? "200", 10);

  let status: RecStatus | RecStatus[] | undefined;
  if (statusParam) {
    status = statusParam.includes(",")
      ? (statusParam.split(",") as RecStatus[])
      : (statusParam as RecStatus);
  }

  try {
    const rows = await listRecommendations(status, limit);
    return Response.json({ ok: true, rows });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
