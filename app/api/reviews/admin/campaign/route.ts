import { type NextRequest } from "next/server";
import { reviewsDb } from "@/lib/reviews/core";
import { buildEmail, reviewUrlFor, sendReviewRequest, type Target } from "@/lib/reviews/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 관리자 전용(게이트 보호). 과거 구매자 리뷰요청 발송.

async function pendingTargets(mall: string, limit?: number): Promise<Target[]> {
  const sb = reviewsDb();
  const { data: sent } = await sb.from("review_request_log").select("email").eq("mall", mall);
  const sentSet = new Set((sent || []).map((r) => r.email));
  let q = sb.from("review_request_targets").select("*").eq("mall", mall).order("months_ago", { ascending: true });
  const { data } = await q;
  const pend = (data || []).filter((t) => !sentSet.has(t.email)) as Target[];
  return limit ? pend.slice(0, limit) : pend;
}

/** 미리보기: 카운트 + 샘플 이메일(recent/relaunch) */
export async function GET(req: NextRequest) {
  const mall = req.nextUrl.searchParams.get("mall") || "harriot_global";
  const sb = reviewsDb();
  const { data: targets } = await sb.from("review_request_targets").select("segment,product_no").eq("mall", mall);
  const { count: sentCount } = await sb.from("review_request_log").select("*", { count: "exact", head: true }).eq("mall", mall);
  const total = (targets || []).length;
  const recent = (targets || []).filter((t) => t.segment === "recent").length;
  const relaunch = (targets || []).filter((t) => t.segment === "relaunch").length;
  const pend = await pendingTargets(mall);

  const sample = (seg: "recent" | "relaunch"): { subject: string; html: string } => {
    const t: Target = { id: "preview", mall: mall as Target["mall"], email: "preview@harriot", customer_name: "James K.",
      product_no: 121, product_name: "KI:WON Black", order_ref: null, segment: seg, months_ago: seg === "recent" ? 2 : 10 };
    return buildEmail(t);
  };
  return Response.json({
    ok: true, counts: { total, recent, relaunch, sent: sentCount || 0, pending: pend.length },
    samples: { recent: sample("recent"), relaunch: sample("relaunch") },
  });
}

/** 발송: { mode:"test", testEmail } | { mode:"live", limit } */
export async function POST(req: NextRequest) {
  let body: { mode?: "test" | "live"; testEmail?: string; mall?: string; limit?: number };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const mall = body.mall || "harriot_global";

  if (body.mode === "test") {
    if (!body.testEmail) return Response.json({ error: "testEmail 필요" }, { status: 400 });
    const mk = (seg: "recent" | "relaunch"): Target => ({ id: "t", mall: mall as Target["mall"], email: body.testEmail!, customer_name: "James K.", product_no: 121, product_name: "KI:WON Black", order_ref: null, segment: seg, months_ago: seg === "recent" ? 2 : 10 });
    const results: Record<string, string> = {};
    for (const seg of ["recent", "relaunch"] as const) {
      const { subject, html } = buildEmail(mk(seg));
      results[seg] = await sendReviewRequest(body.testEmail, `[TEST] ${subject}`, html);
    }
    return Response.json({ ok: true, mode: "test", sentTo: body.testEmail, messageIds: results });
  }

  if (body.mode === "live") {
    const limit = Math.min(60, body.limit || 40);
    const targets = await pendingTargets(mall, limit);
    const sb = reviewsDb();
    let sent = 0; const errors: string[] = [];
    for (const t of targets) {
      try {
        const { subject, html } = buildEmail(t);
        const msgId = await sendReviewRequest(t.email, subject, html);
        await sb.from("review_request_log").insert({ mall, email: t.email, customer_name: t.customer_name, product_no: t.product_no, product_name: t.product_name, segment: t.segment, message_id: msgId, status: "sent" });
        sent++;
        await new Promise((r) => setTimeout(r, 350)); // rate-limit
      } catch (e) {
        errors.push(`${t.email}: ${e instanceof Error ? e.message : e}`);
      }
    }
    const remaining = (await pendingTargets(mall)).length;
    return Response.json({ ok: true, mode: "live", sent, remaining, errors: errors.slice(0, 5) });
  }

  return Response.json({ error: "mode(test|live) 필요" }, { status: 400 });
}
