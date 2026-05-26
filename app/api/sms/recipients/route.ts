import { getValidC24Token } from "@/lib/cafe24Auth";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { fetchRecipients, type RecipientFilter } from "@/lib/sms/recipients";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 주문 필터 → 수신 대상(수령인 휴대폰) 목록. */
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<RecipientFilter>;
  if (!body.startDate || !body.endDate) {
    return Response.json({ ok: false, error: "startDate, endDate required" }, { status: 400 });
  }

  let token = await getValidC24Token();
  if (!token) token = await getAccessTokenFromStore();
  if (!token) {
    return Response.json({ ok: false, error: "카페24 토큰 없음 — 연결을 확인하세요" }, { status: 401 });
  }

  try {
    const recipients = await fetchRecipients(token, {
      startDate: body.startDate,
      endDate: body.endDate,
      productNo: body.productNo ? Number(body.productNo) : undefined,
      optionContains: body.optionContains || undefined,
      shipStatus: body.shipStatus || undefined,
      includeCanceled: !!body.includeCanceled,
    });
    return Response.json({ ok: true, recipients, count: recipients.length });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
