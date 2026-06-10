/**
 * 식스샵 문의하기 게시판(board-productQna) → CS 인박스(item_type=inquiry).
 * 로컬 에이전트(sixshopCsSync.js)가 목록+상세 모달을 긁어 보낸 문의를 ingestMessage 로 적재.
 * 헤더: x-agent-token. Body: { inquiries: [{ externalThreadId, customerName, email, subject, askedAt,
 *        questionBody, answers:[{ body, answeredAt }] }] }
 * 질문=direction 'in', 마스터 답변=direction 'out'. ingestMessage 의 external_message_id dedup 으로 멱등.
 */
import { type NextRequest } from "next/server";
import { ingestMessage } from "@/lib/cs/store";
import type { CsBrandId } from "@/lib/cs/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface InquiryInput {
  brand?: CsBrandId;
  externalThreadId: string;
  customerName?: string;
  email?: string;
  subject?: string;
  askedAt?: string;       // ISO
  questionBody?: string;
  answers?: Array<{ body?: string; answeredAt?: string }>;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-agent-token");
  if (!process.env.PAULWISE_MCP_TOKEN || token !== process.env.PAULWISE_MCP_TOKEN) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { inquiries?: InquiryInput[] };
  const inquiries = Array.isArray(body.inquiries) ? body.inquiries : [];
  let questions = 0, answers = 0, failed = 0;
  for (const q of inquiries) {
    if (!q?.externalThreadId) { failed++; continue; }
    const brand: CsBrandId = q.brand ?? "paulvice";
    const askedAt = q.askedAt ? new Date(q.askedAt) : new Date();
    try {
      // 질문 (in)
      await ingestMessage({
        brand, channel: "sixshop", externalThreadId: q.externalThreadId,
        externalMessageId: `${q.externalThreadId}:q`,
        customerName: q.customerName, customerHandle: q.email, subject: q.subject,
        bodyText: q.questionBody ?? q.subject ?? "", sentAt: askedAt, direction: "in",
        raw: { email: q.email },
      });
      questions++;
      // 기존 마스터 답변들 (out) — 이미 답변된 건 dedup
      for (const [i, a] of (q.answers ?? []).entries()) {
        if (!a?.body) continue;
        await ingestMessage({
          brand, channel: "sixshop", externalThreadId: q.externalThreadId,
          externalMessageId: `${q.externalThreadId}:a:${a.answeredAt || i}`,
          subject: q.subject,
          bodyText: a.body, sentAt: a.answeredAt ? new Date(a.answeredAt) : askedAt, direction: "out",
        });
        answers++;
      }
    } catch {
      failed++;
    }
  }
  return Response.json({ ok: true, received: inquiries.length, questions, answers, failed });
}
