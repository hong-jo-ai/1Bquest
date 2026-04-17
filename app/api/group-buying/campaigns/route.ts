import { listCampaigns, createCampaign } from "@/lib/groupBuying/store";
import type { GbStatus } from "@/lib/groupBuying/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") ?? "all") as GbStatus | "all";
    const search = url.searchParams.get("search") ?? undefined;
    const campaigns = await listCampaigns({ status, search });
    return Response.json({ campaigns });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const campaign = await createCampaign(body);
    return Response.json({ campaign });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
