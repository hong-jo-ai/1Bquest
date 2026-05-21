import { linkChannelCode, linkChannelCodesBulk } from "@/lib/channelPricing/store";
import type { PricingChannel } from "@/lib/channelPricing/types";

export const dynamic = "force-dynamic";

const ALLOWED: PricingChannel[] = ["wconcept", "musinsa", "29cm", "kakao_gift"];

interface LinkItem { channel?: PricingChannel; channelCode?: string; sku?: string }

/**
 * 미매칭 채널 상품을 우리 SKU 에 수동 연결.
 * - 단건: body {channel, channelCode, sku}
 * - 일괄: body {links: [{channel, channelCode, sku}, ...]}
 */
export async function POST(req: Request) {
  let body: LinkItem & { links?: LinkItem[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "본문 파싱 실패" }, { status: 400 });
  }

  try {
    if (Array.isArray(body.links)) {
      const valid = body.links.filter(
        (l): l is { channel: PricingChannel; channelCode: string; sku: string } =>
          !!l.channel && ALLOWED.includes(l.channel) && !!l.channelCode && !!l.sku,
      );
      const count = await linkChannelCodesBulk(valid);
      return Response.json({ ok: true, count });
    }

    const { channel, channelCode, sku } = body;
    if (!channel || !ALLOWED.includes(channel) || !channelCode || !sku) {
      return Response.json({ error: "channel, channelCode, sku 필요" }, { status: 400 });
    }
    await linkChannelCode(channel, channelCode, sku);
    return Response.json({ ok: true, count: 1 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
