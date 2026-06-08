/**
 * 등기번호 직접 배송조회 (시스템에 없는 과거/수기 발송 포함).
 * GET /api/postparcel/track?rgist=등기번호(13자리)
 *   → { rgist, found, state, senderName, receiverName, scans[], error }
 */
import { type NextRequest } from "next/server";
import { trackOne } from "@/lib/postParcel/tracking";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rgist = (req.nextUrl.searchParams.get("rgist") || "").replace(/\D/g, "");
  if (!rgist) return Response.json({ error: "등기번호를 입력하세요" }, { status: 400 });
  const result = await trackOne(rgist);
  return Response.json(result);
}
