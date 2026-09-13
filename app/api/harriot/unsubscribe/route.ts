/**
 * 해리엇 마케팅 메일 수신거부 — 공개 경로(proxy.ts ALLOW_PREFIX).
 *
 * GET  ?e=<base64url email>&t=<hmac>[&c=campaign] → 목록에 추가하고 안내 페이지
 * POST 같은 파라미터 (RFC 8058 List-Unsubscribe=One-Click; Gmail/Apple Mail 의 "수신거부" 버튼) → 200
 * 토큰이 안 맞으면 아무것도 기록하지 않는다.
 */
import { type NextRequest } from "next/server";
import { verifyUnsubscribeParams, addOptOut } from "@/lib/harriot/emailOptOut";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#fff;color:#14181f;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:480px;margin:80px auto;padding:0 20px;line-height:1.7;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;margin-bottom:14px;">${title}</div>
<div style="font-size:15px;color:#3c444f;">${body}</div>
<div style="margin-top:28px;font-size:12.5px;color:#8a919c;">&mdash; Harriot, Seoul</div>
</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

async function handle(req: NextRequest, html: boolean) {
  const q = req.nextUrl.searchParams;
  const email = verifyUnsubscribeParams(q.get("e"), q.get("t"));
  if (!email) {
    return html
      ? page("This link is not valid", "Please reply to the email you received and we will remove you by hand.", 400)
      : Response.json({ ok: false }, { status: 400 });
  }
  try { await addOptOut(email, q.get("c")); } catch {
    return html ? page("Something went wrong", "Please reply to the email you received and we will remove you by hand.", 500) : Response.json({ ok: false }, { status: 500 });
  }
  return html
    ? page("You're unsubscribed", `We won't send marketing emails to <b>${email}</b> again. Order and shipping emails are not affected.`)
    : Response.json({ ok: true });
}

export async function GET(req: NextRequest) { return handle(req, true); }
export async function POST(req: NextRequest) { return handle(req, false); }
