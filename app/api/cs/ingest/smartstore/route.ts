import { ingestSmartstoreInquiries, type SmartstoreInquiry } from "@/lib/cs/smartstoreIngest";

export const maxDuration = 90;
export const dynamic = "force-dynamic";

/**
 * 스마트스토어 1:1 고객문의 → CS 인박스.
 *
 * ⚠️ 네이버 커머스 API 는 IP 화이트리스트라 **여기서 네이버를 직접 부르지 않는다**
 * (Vercel IP 는 등록 불가 → `GW.IP_NOT_ALLOWED`). 문의를 읽어 오는 쪽은 로컬이다:
 * `local-agent/smartstoreCsScan.js` 가 조회해서 이 엔드포인트로 POST 한다.
 *
 * body: `{ "inquiries": [ ... ] }`
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
  try {
    const body = (await req.json()) as { inquiries?: SmartstoreInquiry[] };
    inquiries = Array.isArray(body?.inquiries) ? body.inquiries : [];
  } catch {
    return Response.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  try {
    const res = await ingestSmartstoreInquiries(inquiries);
    return Response.json({ ok: true, ...res });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
