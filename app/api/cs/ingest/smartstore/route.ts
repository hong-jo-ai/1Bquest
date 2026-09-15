import {
  ingestSmartstoreInquiries,
  ingestSmartstoreQnas,
  type SmartstoreInquiry,
  type SmartstoreQna,
} from "@/lib/cs/smartstoreIngest";

export const maxDuration = 90;
export const dynamic = "force-dynamic";

/**
 * 스마트스토어 1:1 고객문의 → CS 인박스.
 *
 * ⚠️ 네이버 커머스 API 는 IP 화이트리스트라 **여기서 네이버를 직접 부르지 않는다**
 * (Vercel IP 는 등록 불가 → `GW.IP_NOT_ALLOWED`). 문의를 읽어 오는 쪽은 로컬이다:
 * `local-agent/smartstoreCsScan.js` 가 조회해서 이 엔드포인트로 POST 한다.
 *
 * body: `{ "inquiries": [ ... ], "qnas": [ ... ] }` — 고객문의(1:1)와 상품 Q&A 는 네이버에서 별개 API.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const agent = req.headers.get("x-agent-token");
    const ok = auth === `Bearer ${secret}` || (agent && agent === process.env.PAULWISE_MCP_TOKEN);
    if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let inquiries: SmartstoreInquiry[];
  let qnas: SmartstoreQna[];
  try {
    const body = (await req.json()) as { inquiries?: SmartstoreInquiry[]; qnas?: SmartstoreQna[] };
    inquiries = Array.isArray(body?.inquiries) ? body.inquiries : [];
    qnas = Array.isArray(body?.qnas) ? body.qnas : [];
  } catch {
    return Response.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  try {
    const a = await ingestSmartstoreInquiries(inquiries);
    const b = await ingestSmartstoreQnas(qnas);
    return Response.json({
      ok: true,
      scanned: a.scanned + b.scanned,
      inserted: a.inserted + b.inserted,
      newInboundThreadIds: [...a.newInboundThreadIds, ...b.newInboundThreadIds],
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
