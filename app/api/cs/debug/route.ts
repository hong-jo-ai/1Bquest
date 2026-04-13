import { getCsSupabase } from "@/lib/cs/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getCsSupabase();
  const result: Record<string, unknown> = {};

  // Test 1: select * (no filter)
  const t1 = await db.from("cs_accounts").select("*");
  result.test1_all = {
    error: t1.error,
    count: t1.data?.length ?? 0,
    rows: t1.data?.map((r) => ({
      id: r.id,
      brand: r.brand,
      channel: r.channel,
      status: r.status,
      display_name: r.display_name,
      has_credentials: !!r.credentials,
    })),
  };

  // Test 2: filter channel=gmail
  const t2 = await db.from("cs_accounts").select("*").eq("channel", "gmail");
  result.test2_gmail = {
    error: t2.error,
    count: t2.data?.length ?? 0,
  };

  // Test 3: filter channel=gmail AND status=active (same as listGmailAccounts)
  const t3 = await db
    .from("cs_accounts")
    .select("*")
    .eq("channel", "gmail")
    .eq("status", "active");
  result.test3_gmail_active = {
    error: t3.error,
    count: t3.data?.length ?? 0,
    rows: t3.data?.map((r) => ({
      id: r.id,
      brand: r.brand,
      channel: r.channel,
      status: r.status,
      display_name: r.display_name,
    })),
  };

  // Test 4: env check
  result.env = {
    SUPABASE_URL_host: process.env.SUPABASE_URL
      ? new URL(process.env.SUPABASE_URL).hostname
      : null,
    SUPABASE_SERVICE_ROLE_KEY_present: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY_length:
      process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0,
    SUPABASE_SERVICE_ROLE_KEY_starts:
      process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 10) ?? null,
  };

  return Response.json(result, { status: 200 });
}
