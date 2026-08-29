/**
 * CARE 본인확인 — 인증번호 발송/검증.
 * 공개 라우트(고객이 QR로 들어와 쓴다). 남용 방지는 번호당 쿨다운으로만 건다.
 *
 * POST /api/care/otp            { phone }        → 인증번호 문자 발송
 * POST /api/care/otp?verify=1   { phone, code }  → 검증
 */
import { type NextRequest } from "next/server";
import { issueOtp, verifyOtp, digits, isMobile } from "@/lib/care/store";
import { sendMany } from "@/lib/sms/solapi";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const COOLDOWN_SEC = 30;

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: cors(req) }); }

export async function POST(req: NextRequest) {
  const headers = cors(req);
  const b = (await req.json().catch(() => ({}))) as { phone?: string; code?: string };
  const phone = digits(b.phone);
  if (!isMobile(phone)) return Response.json({ ok: false, error: "휴대폰 번호를 확인해 주세요" }, { status: 400, headers });

  if (req.nextUrl.searchParams.get("verify")) {
    const r = await verifyOtp(phone, String(b.code ?? ""));
    return Response.json(r.ok ? { ok: true } : { ok: false, error: r.reason }, { status: r.ok ? 200 : 400, headers });
  }

  // 쿨다운 — 같은 번호로 30초 안에 재발송 금지(문자 폭탄·요금 방지)
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const ck = `care:otp:cool:${phone}`;
    const { data } = await sb.from("kv_store").select("data").eq("key", ck).maybeSingle();
    const until = Number((data?.data as { until?: number } | undefined)?.until ?? 0);
    if (Date.now() < until) {
      return Response.json({ ok: false, error: "잠시 후 다시 시도해 주세요" }, { status: 429, headers });
    }
    await sb.from("kv_store").upsert({ key: ck, data: { until: Date.now() + COOLDOWN_SEC * 1000 }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  }

  const code = await issueOtp(phone);
  const out = await sendMany([{ to: phone, text: `[폴바이스] 인증번호 ${code}\nPAULVICE CARE 등록을 위해 입력해 주세요.` }]);
  if (!out.ok && out.successCount === 0) {
    return Response.json({ ok: false, error: "문자 발송에 실패했습니다" }, { status: 502, headers });
  }
  return Response.json({ ok: true }, { headers });
}
