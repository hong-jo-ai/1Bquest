import { getCsSupabase } from "@/lib/cs/store";

export const dynamic = "force-dynamic";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export async function GET() {
  const checks: CheckResult[] = [];

  // 1. 환경변수
  const envVars = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "CRON_SECRET",
  ];
  for (const v of envVars) {
    checks.push({
      name: `env: ${v}`,
      ok: !!process.env[v],
      detail: process.env[v] ? undefined : "미설정",
    });
  }

  // 2. Supabase 테이블 존재 확인
  let db;
  try {
    db = getCsSupabase();
  } catch (e) {
    checks.push({
      name: "Supabase 클라이언트",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return Response.json({ ok: false, checks });
  }

  for (const table of ["cs_threads", "cs_messages", "cs_accounts"]) {
    try {
      const { error } = await db.from(table).select("id").limit(1);
      checks.push({
        name: `table: ${table}`,
        ok: !error,
        detail: error?.message,
      });
    } catch (e) {
      checks.push({
        name: `table: ${table}`,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 3. 연결된 계정 개수
  try {
    const { data, error } = await db
      .from("cs_accounts")
      .select("brand, channel, status")
      .eq("channel", "gmail");
    if (error) throw error;
    const active = (data ?? []).filter((a) => a.status === "active");
    checks.push({
      name: "Gmail 계정 연결",
      ok: active.length >= 2,
      detail: `${active.length}/2 연결됨 (${(data ?? [])
        .map((a) => a.brand)
        .join(", ") || "없음"})`,
    });
  } catch (e) {
    checks.push({
      name: "Gmail 계정 조회",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. Telegram 봇 도달성
  const telToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telToken) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${telToken}/getMe`);
      const json = (await res.json()) as { ok: boolean; result?: { username?: string } };
      checks.push({
        name: "Telegram 봇",
        ok: json.ok,
        detail: json.ok ? `@${json.result?.username}` : "getMe 실패",
      });
    } catch (e) {
      checks.push({
        name: "Telegram 봇",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const ok = checks.every((c) => c.ok);
  return Response.json({ ok, checks });
}
