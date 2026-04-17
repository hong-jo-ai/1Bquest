import { getCampaignStats } from "@/lib/groupBuying/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await getCampaignStats();
    return Response.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
