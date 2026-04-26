import { fetchNaverQnas, type NaverQna } from "../naverCommerceClient";
import { ingestMessage } from "./store";
import type { IngestPayload } from "./types";

function preview(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export async function syncNaverQnas(): Promise<{
  qnas: number;
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let qnas: NaverQna[] = [];

  try {
    qnas = await fetchNaverQnas({ sinceDays: 14 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`네이버 Q&A 조회 실패: ${msg}`);
    return { qnas: 0, inserted: 0, skipped: 0, errors };
  }

  let inserted = 0;
  let skipped = 0;

  for (const q of qnas) {
    const externalThreadId = `naver_qna_${q.inquiryNo}`;
    const writerName = q.customerName ?? q.customerId ?? "(고객)";
    const subject = q.productName
      ? `[${q.productName}] ${q.inquiryTitle ?? ""}`.trim()
      : (q.inquiryTitle ?? "네이버 상품 문의");

    // 1) 고객 문의 (수신)
    const inPayload: IngestPayload = {
      brand: "paulvice",
      channel: "naver_qna",
      externalThreadId,
      externalMessageId: `${externalThreadId}_question`,
      customerHandle: q.customerId ?? undefined,
      customerName: writerName,
      subject,
      bodyText: preview(q.inquiryContent) || subject,
      sentAt: new Date(q.inquiryRegistrationDateTime),
      direction: "in",
      raw: q,
    };

    try {
      const r1 = await ingestMessage(inPayload);
      if (r1.inserted) inserted++;
      else skipped++;
    } catch (e) {
      errors.push(
        `inquiry ${q.inquiryNo} ingest 실패: ${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }

    // 2) 답변이 이미 있으면 out 메시지로 기록 → 상태가 waiting으로
    if (q.answered && q.answerContent) {
      const outPayload: IngestPayload = {
        brand: "paulvice",
        channel: "naver_qna",
        externalThreadId,
        externalMessageId: `${externalThreadId}_answer`,
        customerHandle: q.customerId ?? undefined,
        customerName: writerName,
        subject,
        bodyText: preview(q.answerContent),
        sentAt: new Date(
          q.answerRegistrationDateTime ?? q.inquiryRegistrationDateTime
        ),
        direction: "out",
        raw: { answer_placeholder: true, content: q.answerContent },
      };
      try {
        const r2 = await ingestMessage(outPayload);
        if (r2.inserted) inserted++;
        else skipped++;
      } catch (e) {
        errors.push(
          `inquiry ${q.inquiryNo} answer ingest 실패: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  return { qnas: qnas.length, inserted, skipped, errors };
}
