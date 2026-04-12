import { getCsSupabase } from "@/lib/cs/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getCsSupabase();
    const { data, error } = await db
      .from("cs_accounts")
      .select("id, brand, channel, display_name, status, last_synced_at, error_message")
      .order("brand");
    if (error) throw new Error(error.message);
    return Response.json({ accounts: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
