/**
 * 실제 인스타 DM 대화가 있는 핸들 목록.
 * 인플루언서 매니저가 한 번 조회해 "대화중" 배지를 카드에 표시하는 용도.
 */
import { getCsSupabase } from "@/lib/cs/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getCsSupabase();
  const { data, error } = await db
    .from("cs_threads")
    .select("customer_handle")
    .eq("channel", "ig_dm")
    .eq("brand", "paulvice")
    .not("customer_handle", "is", null);
  if (error) return Response.json({ ok: false, error: error.message, handles: [] }, { status: 500 });

  const handles = Array.from(
    new Set(
      (data ?? [])
        .map((r) => String(r.customer_handle ?? "").replace(/^@/, "").toLowerCase())
        .filter(Boolean),
    ),
  );
  return Response.json({ ok: true, handles });
}
