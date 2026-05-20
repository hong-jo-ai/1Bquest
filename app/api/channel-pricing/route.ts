import { assembleCatalog, KAKAO_FEE_RATE } from "@/lib/channelPricing/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await assembleCatalog();
    return Response.json({ ok: true, ...result, kakaoFeeRate: KAKAO_FEE_RATE });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
