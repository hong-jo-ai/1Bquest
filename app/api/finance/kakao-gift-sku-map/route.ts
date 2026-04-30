import { loadKakaoGiftSkuMap, saveKakaoGiftSkuMap, type KakaoSkuMapEntry } from "@/lib/finance/kakaoGiftSkuMap";
import { cafe24Get } from "@/lib/cafe24Client";
import { getValidC24Token } from "@/lib/cafe24Auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// ── 자동 매칭: 카카오 상품명 → Cafe24 product_code ──
// POST { entries: [{ kakaoSku, kakaoName }] } → [{ kakaoSku, kakaoName, suggestedCode, confidence, candidates? }]

interface RawProduct { product_no: number; product_code?: string; product_name?: string }

async function fetchAllCafe24Products(token: string): Promise<RawProduct[]> {
  const all: RawProduct[] = [];
  let offset = 0;
  for (let i = 0; i < 30; i++) {
    const data = await cafe24Get(`/api/v2/admin/products?limit=100&offset=${offset}&fields=product_no,product_code,product_name`, token);
    const batch = (data.products ?? []) as RawProduct[];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return all;
}

/** 토큰 기반 단순 자카드 유사도 */
function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_(),.\\\/]+/g, " ").trim();
  const tokensA = new Set(norm(a).split(" ").filter(Boolean));
  const tokensB = new Set(norm(b).split(" ").filter(Boolean));
  const intersection = [...tokensA].filter((t) => tokensB.has(t));
  const union = new Set([...tokensA, ...tokensB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

export async function POST(req: Request) {
  let body: { entries?: Array<{ kakaoSku: string; kakaoName: string }> };
  try { body = await req.json(); }
  catch { return Response.json({ ok: false, error: "잘못된 본문" }, { status: 400 }); }
  if (!Array.isArray(body.entries)) {
    return Response.json({ ok: false, error: "entries 배열 필수" }, { status: 400 });
  }

  const token = await getValidC24Token();
  if (!token) return Response.json({ ok: false, error: "Cafe24 미연결" }, { status: 401 });
  const products = await fetchAllCafe24Products(token);

  const suggestions = body.entries.map((e) => {
    const isMultiOption = /택\s*\d|\(\s*\d+\s*종/i.test(e.kakaoName); // '5종 택1' 류 패턴
    if (isMultiOption) {
      return {
        kakaoSku:        e.kakaoSku,
        kakaoName:       e.kakaoName,
        suggestedCode:   "",
        confidence:      0,
        warning:         "1:N 패턴 — 부모 SKU 라 단일 매칭 불가. 발주서 기반 색상별 매칭 필요.",
      };
    }
    // 모든 Cafe24 상품과 유사도 계산
    const scored = products.map((p) => ({
      product: p,
      score:   similarity(e.kakaoName, p.product_name ?? ""),
    })).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < 0.3) {
      return {
        kakaoSku:        e.kakaoSku,
        kakaoName:       e.kakaoName,
        suggestedCode:   "",
        confidence:      best?.score ?? 0,
        warning:         best ? `최고 유사도 ${(best.score * 100).toFixed(0)}% — 신뢰도 낮음. 수동 확인 필요.` : "Cafe24 상품 없음",
        candidates:      scored.slice(0, 3).map((s) => ({ code: s.product.product_code, name: s.product.product_name, score: Math.round(s.score * 100) })),
      };
    }
    return {
      kakaoSku:        e.kakaoSku,
      kakaoName:       e.kakaoName,
      suggestedCode:   best.product.product_code ?? "",
      confidence:      best.score,
      matchedName:     best.product.product_name,
      candidates:      scored.slice(0, 3).map((s) => ({ code: s.product.product_code, name: s.product.product_name, score: Math.round(s.score * 100) })),
    };
  });

  return Response.json({ ok: true, suggestions });
}
