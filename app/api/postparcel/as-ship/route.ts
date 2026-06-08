/**
 * AS 수리완료 → 고객 발송 송장 한 번에 접수.
 * POST { asId, zip?, prod? }
 *   - as_requests 에서 고객 정보(customer_name/phone/address, model) 읽음
 *   - 우체국 접수(source=AS) → 성공 시 as_requests.return_tracking_no=regiNo, status='shipped'
 * recZip 은 as_requests 에 없으므로 body.zip 우선, 없으면 주소에서 5자리 추출.
 */
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { registerOne } from "@/lib/postParcel/agentCall";

export const dynamic = "force-dynamic";

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest) {
  const { asId, zip, prod } = await req.json().catch(() => ({}));
  if (!asId) return Response.json({ error: "asId 필요" }, { status: 400 });

  const client = sb();
  const { data: as, error } = await client.from("as_requests").select("*").eq("id", asId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!as) return Response.json({ error: "AS 접수 없음" }, { status: 404 });

  const addr = as.customer_address || "";
  const zipCode = String(zip || (addr.match(/\b\d{5}\b/)?.[0] ?? "")).replace(/\D/g, "");
  if (!as.customer_name || !addr) {
    return Response.json({ error: "고객명/주소 누락 (AS 접수에 반송주소 입력 필요)" }, { status: 400 });
  }
  if (!zipCode) {
    return Response.json({ error: "우편번호 필요 (주소에서 추출 실패 — zip 직접 전달)" }, { status: 400 });
  }

  try {
    const result = await registerOne(
      {
        order: `AS-${asId}`,
        name: as.customer_name,
        addr,
        zip: zipCode,
        mobile: as.customer_phone || "",
        prod: prod || as.model || "수리완료 제품",
        qty: "1",
      },
      "AS"
    );
    if (!result.success) {
      return Response.json({ error: result.error || "접수 실패", code: result.code }, { status: 502 });
    }
    // 실접수(비테스트)면 AS 레코드에 송장 기록 + 발송완료 처리
    const isReal = result.regiNo && result.regiNo !== "TESTREGINOAPI";
    await client
      .from("as_requests")
      .update({
        return_tracking_no: isReal ? result.regiNo : as.return_tracking_no,
        status: "shipped",
        shipped_at: new Date().toISOString(),
      })
      .eq("id", asId);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || "에이전트 호출 실패 (로컬 에이전트 확인)" },
      { status: 502 }
    );
  }
}
