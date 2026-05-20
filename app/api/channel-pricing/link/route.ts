import { linkChannelCode } from "@/lib/channelPricing/store";
import type { PricingChannel } from "@/lib/channelPricing/types";

export const dynamic = "force-dynamic";

const ALLOWED: PricingChannel[] = ["wconcept", "musinsa", "29cm", "kakao_gift"];

/** 미매칭 채널 상품을 우리 SKU 에 수동 연결. body: {channel, channelCode, sku} */
export async function POST(req: Request) {
  let body: { channel?: PricingChannel; channelCode?: string; sku?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "본문 파싱 실패" }, { status: 400 });
  }
  const { channel, channelCode, sku } = body;
  if (!channel || !ALLOWED.includes(channel) || !channelCode || !sku) {
    return Response.json({ error: "channel, channelCode, sku 필요" }, { status: 400 });
  }
  try {
    await linkChannelCode(channel, channelCode, sku);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
