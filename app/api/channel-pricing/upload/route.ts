import { type NextRequest } from "next/server";
import { parseChannelProductList, parseKakaoGiftSales } from "@/lib/channelPricing/parsers";
import { saveChannelRaw } from "@/lib/channelPricing/store";
import type { PricingChannel } from "@/lib/channelPricing/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOWED: PricingChannel[] = ["wconcept", "musinsa", "29cm", "kakao_gift"];
const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get("channel") as PricingChannel | null;
  if (!channel || !ALLOWED.includes(channel)) {
    return Response.json({ error: "channel 파라미터 필요 (wconcept | musinsa | 29cm | kakao_gift)" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "file 필드 없음" }, { status: 400 });
  if (file.size > MAX_SIZE) return Response.json({ error: "10MB 이하만 가능" }, { status: 413 });
  if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
    return Response.json({ error: ".xlsx / .xls / .csv 만 가능" }, { status: 415 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const result =
      channel === "kakao_gift" ? parseKakaoGiftSales(buf) : parseChannelProductList(channel, buf);

    if (result.products.length === 0) {
      return Response.json({ ok: false, error: "추출된 상품 0건", warnings: result.warnings }, { status: 422 });
    }
    await saveChannelRaw(channel, result.products);
    return Response.json({
      ok: true,
      channel,
      fileName: file.name,
      count: result.products.length,
      priced: result.products.filter((p) => p.discount != null).length,
      warnings: result.warnings,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
