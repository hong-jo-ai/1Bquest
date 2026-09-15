/**
 * 스마트스토어(네이버) 1:1 고객 문의 → CS 인박스 적재.
 *
 * 마켓 CS 는 원래 인박스로 안 가져오는 게 방침이다(2026-09-01) — 답장이 각 마켓 어드민에서만
 * 되기 때문이다. **스마트스토어는 예외다.** 커머스 API 가 답변 등록까지 열려 있어
 * (`POST /v1/pay-merchant/inquiries/:inquiryNo/answer`) 인박스에서 읽고 답장까지 끝난다.
 *
 * ⚠️ **네이버 커머스 API 는 IP 화이트리스트다** (Vercel 에서 부르면 `GW.IP_NOT_ALLOWED` 403).
 * 그래서 네이버 호출은 전부 local-agent 가 하고, 이 모듈은 **넘겨받은 문의 배열을 적재만** 한다.
 *  - 수집: `local-agent/smartstoreCsScan.js` → `POST /api/cs/ingest/smartstore { inquiries }`
 *  - 답변: `enqueueCsAction("smartstore_reply")` → `csActionWorker.js` 가 로컬에서 전송
 *
 * 스레드 = 문의 1건(inquiryNo). 네이버 1:1 문의는 원글-답변 한 쌍으로 끝나고 스레드가
 * 이어지지 않으므로, 문의마다 스레드를 만들고 답변을 out 메시지로 붙인다.
 */
import { ingestMessage } from "./store";

/** 스마트스토어는 해리엇 스토어 하나뿐이라 브랜드 고정. */
const BRAND = "harriot" as const;

/** local-agent 가 네이버에서 읽어 넘겨주는 문의 1건. */
export interface SmartstoreInquiry {
  inquiryNo: number;
  category?: string;
  title?: string;
  inquiryContent?: string;
  inquiryRegistrationDateTime?: string;
  customerId?: string;
  customerName?: string;
  answered?: boolean;
  answerContent?: string;
  answerRegistrationDateTime?: string;
  productName?: string;
  productOrderId?: string;
  orderId?: string;
}

export function smartstoreThreadId(inquiryNo: number): string {
  return `smartstore_inquiry_${inquiryNo}`;
}

/** 문의 본문에 상품/주문 정보를 붙여 인박스에서 맥락이 보이게 한다. */
function buildBody(q: SmartstoreInquiry): string {
  const lines: string[] = [];
  if (q.inquiryContent) lines.push(q.inquiryContent.trim());
  const meta: string[] = [];
  if (q.productName) meta.push(`상품: ${q.productName}`);
  if (q.productOrderId) meta.push(`주문: ${q.productOrderId}`);
  else if (q.orderId) meta.push(`주문: ${q.orderId}`);
  if (q.category) meta.push(`분류: ${q.category}`);
  if (meta.length) lines.push("", `— ${meta.join(" · ")}`);
  return lines.join("\n");
}

function toDate(v?: string): Date {
  if (!v) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export interface SmartstoreIngestResult {
  scanned: number;
  inserted: number;
  newInboundThreadIds: string[];
}

export async function ingestSmartstoreInquiries(
  inquiries: SmartstoreInquiry[],
): Promise<SmartstoreIngestResult> {
  const out: SmartstoreIngestResult = { scanned: 0, inserted: 0, newInboundThreadIds: [] };

  for (const q of inquiries) {
    if (!q || typeof q.inquiryNo !== "number") continue;
    out.scanned++;
    const externalThreadId = smartstoreThreadId(q.inquiryNo);

    const inbound = await ingestMessage({
      brand: BRAND,
      channel: "smartstore",
      externalThreadId,
      externalMessageId: `${externalThreadId}_q`,
      customerName: q.customerName ?? undefined,
      customerHandle: q.customerId ?? undefined,
      subject: q.title ?? q.category ?? "스마트스토어 문의",
      bodyText: buildBody(q),
      sentAt: toDate(q.inquiryRegistrationDateTime),
      direction: "in",
      raw: { source: "smartstore", inquiry: q },
    });
    if (inbound.inserted) {
      out.inserted++;
      out.newInboundThreadIds.push(inbound.threadId);
    }

    // 이미 스토어에서 답변한 건은 out 메시지로 같이 넣어야 인박스가 "미답변"으로 오해하지 않는다.
    //
    // ⚠️ `answerContent` 가 없어도 `answered:true` 면 답변된 것으로 본다.
    //    네이버는 답변 직후 조회에서 **answered:true / answerContent:null** 을 돌려주는 경우가 있다
    //    (2026-09-15 손*원 문의 325836634 — 우리가 10:27 에 보낸 답변이 answered 로만 반영됨).
    //    본문이 있을 때만 적재하면 그 건은 인박스에 영원히 '미답변'으로 남고, 그걸 보고
    //    **또 답장을 보내게 된다**(실제로 그날 중복 발송이 났다). 네이버는 문의당 답변 1회뿐이라
    //    중복 시도는 실패로 끝나지만, 응대 판단 자체가 오염된다.
    if (q.answered) {
      const answered = await ingestMessage({
        brand: BRAND,
        channel: "smartstore",
        externalThreadId,
        externalMessageId: `${externalThreadId}_a`,
        bodyText: q.answerContent?.trim() || "(스토어에서 답변함 — 본문 미제공)",
        sentAt: toDate(q.answerRegistrationDateTime),
        direction: "out",
        raw: { source: "smartstore", sent_via: "smartstore_admin" },
      });
      if (answered.inserted) out.inserted++;
    }
  }

  return out;
}
