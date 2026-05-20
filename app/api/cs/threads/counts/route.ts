import { countThreadsByStatus } from "@/lib/cs/store";
import type { CsChannel } from "@/lib/cs/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const brand = (url.searchParams.get("brand") ?? "all") as
    | "paulvice"
    | "harriot"
    | "all";
  const channel = (url.searchParams.get("channel") ?? "all") as CsChannel | "all";

  try {
    const counts = await countThreadsByStatus({ brand, channel });
    return Response.json({ counts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
