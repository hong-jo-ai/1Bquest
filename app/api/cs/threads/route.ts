import { listThreads } from "@/lib/cs/store";
import type { CsChannel, CsStatus } from "@/lib/cs/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "all") as CsStatus | "all";
  const brand = (url.searchParams.get("brand") ?? "all") as
    | "paulvice"
    | "harriot"
    | "all";
  const channel = (url.searchParams.get("channel") ?? "all") as CsChannel | "all";

  try {
    const threads = await listThreads({ status, brand, channel, limit: 200 });
    return Response.json({ threads });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
