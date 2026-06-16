/**
 * 알바 급여명세서 크론/수동 — 직전 달(또는 ?ym=YYYY-MM) 급여명세서를 텔레그램으로 발송.
 * Vercel 크론: 매월 1일 09:00 KST(00:00 UTC) → 지난달 명세서. ?dry=1 이면 발송 없이 미리보기.
 */
import { buildPayslip, sendPayslip } from "@/lib/alba/attendance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const ym = url.searchParams.get("ym") || undefined;
  const dry = url.searchParams.get("dry");
  try {
    const text = dry ? await buildPayslip(ym) : await sendPayslip(ym);
    return Response.json({ ok: true, sent: !dry, text });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) { return GET(req); }
