import { listSmsSends } from "@/lib/sms/store";
import { smsConfigured } from "@/lib/sms/solapi";

export const dynamic = "force-dynamic";

/** 최근 발송 이력 + Solapi 설정 상태. */
export async function GET() {
  try {
    const [history, cfg] = await Promise.all([
      listSmsSends(30),
      Promise.resolve(smsConfigured()),
    ]);
    return Response.json({ ok: true, history, configured: cfg.ok, missing: cfg.missing });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
