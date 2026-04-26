import { getCsSupabase } from "@/lib/cs/store";
import {
  classifyEmail,
  getSenderBlacklist,
  isBlacklisted,
  isNonCsSender,
} from "@/lib/cs/classifier";
import type { CsBrandId } from "@/lib/cs/types";

export const maxDuration = 300; // 최대 5분 (Gemini RPM 제한 고려)
export const dynamic = "force-dynamic";

/**
 * Gmail 채널의 미처리 스레드를 재분류해서 고객 문의가 아닌 것은 archived 처리.
 *
 * 대상: 최근 14일, channel=gmail, status in ('unanswered','waiting')
 *      → 사용자가 이미 손댄 'resolved' / 'archived'는 건드리지 않음
 *
 * 정책: Gemini 분류 isCs=false 인 경우만 archived로 변경.
 *       오분류로 진짜 문의가 묻히지 않도록 confidence < 0.7이면 보존.
 */
async function run() {
  const db = getCsSupabase();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: threads, error: tErr } = await db
    .from("cs_threads")
    .select("id, brand, subject, customer_handle, customer_name, last_message_at, status")
    .eq("channel", "gmail")
    .gte("last_message_at", since)
    .in("status", ["unanswered", "waiting"])
    .order("last_message_at", { ascending: false })
    .limit(200);

  if (tErr) {
    return Response.json({ ok: false, error: tErr.message }, { status: 500 });
  }
  const candidates = threads ?? [];
  const blacklist = await getSenderBlacklist();

  const result = {
    ok: true as const,
    examined: candidates.length,
    archived: 0,
    kept: 0,
    skipped_low_confidence: 0,
    errors: [] as string[],
    archived_samples: [] as Array<{
      brand: string;
      from: string | null;
      subject: string | null;
      category: string;
      reason: string;
    }>,
  };

  // Gemini 무료 티어 RPM=15 → 4초당 1건 정도. 안전하게 순차 처리 + 작은 텀
  for (const t of candidates) {
    try {
      // 가장 최근 수신(in) 메시지 1건
      const { data: msgRows } = await db
        .from("cs_messages")
        .select("body_text, body_html, sent_at")
        .eq("thread_id", t.id)
        .eq("direction", "in")
        .order("sent_at", { ascending: false })
        .limit(1);
      const msg = msgRows?.[0];
      if (!msg) {
        result.kept++;
        continue;
      }

      // 블랙리스트 또는 NON-CS 도메인 패턴은 즉시 archived (LLM 호출 안 함)
      if (
        isBlacklisted(t.customer_handle, blacklist) ||
        isNonCsSender(t.customer_handle)
      ) {
        await db.from("cs_threads").update({ status: "archived" }).eq("id", t.id);
        result.archived++;
        if (result.archived_samples.length < 30) {
          result.archived_samples.push({
            brand: t.brand,
            from: t.customer_handle,
            subject: t.subject,
            category: "hard_skip_pattern",
            reason: "발신자가 NON-CS 패턴(블랙리스트/입점 플랫폼/거래처)에 매칭",
          });
        }
        continue;
      }

      const bodySnippet =
        (msg.body_text as string | null) ??
        ((msg.body_html as string | null)?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "");

      const cls = await classifyEmail({
        brand: t.brand as CsBrandId,
        fromName: t.customer_name,
        fromEmail: t.customer_handle,
        subject: t.subject ?? "",
        bodySnippet,
      });

      if (cls.isCs) {
        result.kept++;
        continue;
      }

      // isCs=false 이지만 confidence가 낮으면 보존 (오분류로 진짜 문의 묻히는 것 방지)
      if (cls.confidence < 0.7) {
        result.skipped_low_confidence++;
        continue;
      }

      const { error: uErr } = await db
        .from("cs_threads")
        .update({ status: "archived" })
        .eq("id", t.id);
      if (uErr) {
        result.errors.push(`${t.id}: ${uErr.message}`);
        continue;
      }
      result.archived++;
      if (result.archived_samples.length < 20) {
        result.archived_samples.push({
          brand: t.brand,
          from: t.customer_handle,
          subject: t.subject,
          category: cls.category,
          reason: cls.reason,
        });
      }

      // 무료 티어 RPM=15 → 약 4초 텀 (안전 마진)
      await new Promise((r) => setTimeout(r, 4500));
    } catch (e) {
      result.errors.push(`${t.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return Response.json(result);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  return run();
}

export async function POST(req: Request) {
  return GET(req);
}
