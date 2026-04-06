export const maxDuration = 60;

import { getValidC24Token } from "@/lib/cafe24Auth";
import { cafe24Get } from "@/lib/cafe24Client";
import { loadServerHistory } from "@/lib/jewelryClearance";
import { NextResponse } from "next/server";

// 디버그: 현재 상품 가격 + 저장된 원래 가격 비교
export async function GET() {
  const token = await getValidC24Token();
  if (!token) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  try {
    const history = await loadServerHistory();

    // 카테고리 44 상품 조회
    const data = await cafe24Get(
      `/api/v2/admin/products?limit=10&display=T&category=44`,
      token
    );
    const products = (data.products ?? []).map((p: any) => ({
      product_no: p.product_no,
      name: p.product_name,
      sku: p.product_code,
      price: p.price,
      retail_price: p.retail_price,
      supply_price: p.supply_price,
      historyOriginalPrice: history.originalPrices[p.product_code ?? String(p.product_no)] ?? "없음",
    }));

    return NextResponse.json({
      products,
      totalOriginalPrices: Object.keys(history.originalPrices).length,
      sampleOriginalPrices: Object.entries(history.originalPrices).slice(0, 5),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
