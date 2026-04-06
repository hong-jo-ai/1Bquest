export const maxDuration = 60;

import { getValidC24Token } from "@/lib/cafe24Auth";
import { cafe24Get, cafe24Put } from "@/lib/cafe24Client";
import { loadServerHistory, saveServerHistory } from "@/lib/jewelryClearance";
import { NextResponse } from "next/server";

// POST: 모든 주얼리 상품 가격을 원래대로 복구
export async function POST() {
  const token = await getValidC24Token();
  if (!token) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  try {
    const history = await loadServerHistory();

    // 카테고리 44 상품 조회
    const allProducts: any[] = [];
    let offset = 0;
    while (true) {
      const data = await cafe24Get(
        `/api/v2/admin/products?limit=100&display=T&offset=${offset}&category=44`,
        token
      );
      const batch: any[] = data.products ?? [];
      allProducts.push(...batch);
      if (batch.length < 100) break;
      offset += 100;
    }

    let restored = 0;
    const errors: string[] = [];

    for (const p of allProducts) {
      const sku = p.product_code ?? String(p.product_no);
      const originalPrice = history.originalPrices[sku];
      if (!originalPrice) continue;

      const currentPrice = parseFloat(p.price ?? "0");
      if (currentPrice === originalPrice) continue; // 이미 원래 가격

      // 429 재시도
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await cafe24Put(
            `/api/v2/admin/products/${p.product_no}`,
            token,
            {
              request: {
                price: String(originalPrice),
                retail_price: String(originalPrice),
              },
            }
          );
          restored++;
          break;
        } catch (err: any) {
          if (err.message?.includes("429") && attempt < 2) {
            await delay(2000 * (attempt + 1));
            continue;
          }
          errors.push(`${sku}: ${err.message}`);
          break;
        }
      }
    }

    // 이력 초기화 (원래 가격으로 복구했으므로 이력 리셋)
    history.entries = [];
    await saveServerHistory(history);

    return NextResponse.json({
      success: true,
      totalProducts: allProducts.length,
      restored,
      errors,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
