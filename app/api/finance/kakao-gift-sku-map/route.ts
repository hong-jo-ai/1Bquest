import { loadKakaoGiftSkuMap, saveKakaoGiftSkuMap, type KakaoSkuMapEntry } from "@/lib/finance/kakaoGiftSkuMap";

export const dynamic = "force-dynamic";

export async function GET() {
  const mappings = await loadKakaoGiftSkuMap();
  return Response.json({ ok: true, mappings });
}

export async function PUT(req: Request) {
  let body: { mappings?: KakaoSkuMapEntry[] };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }
  if (!Array.isArray(body.mappings)) {
    return Response.json({ ok: false, error: "mappings 배열 필수" }, { status: 400 });
  }
  await saveKakaoGiftSkuMap(body.mappings);
  return Response.json({ ok: true, count: body.mappings.length });
}
