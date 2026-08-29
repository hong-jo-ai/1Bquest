/**
 * CARE 제품 선택 목록 — 고객이 "내가 산 제품"을 탭 하나로 고르는 화면용.
 * 시리얼·주문번호를 묻지 않으므로 이 목록이 유일한 식별 수단이다.
 * 판매중인 시계만 노출하고, 없으면 "목록에 없어요"로 빠진다.
 */
import { getValidC24Token } from "@/lib/cafe24Auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface P { product_no: number; product_name: string; display: string; selling: string; list_image?: string; price?: string }

export async function GET() {
  try {
    const token = await getValidC24Token("paulvice");
    if (!token) return Response.json({ ok: true, products: [] });
    const mall = process.env.CAFE24_MALL_ID;
    const r = await fetch(
      `https://${mall}.cafe24api.com/api/v2/admin/products?limit=100&display=T&selling=T&fields=product_no,product_name,list_image,price`,
      { headers: { Authorization: `Bearer ${token}`, "X-Cafe24-Api-Version": "2026-03-01" }, cache: "no-store" },
    );
    const j = (await r.json()) as { products?: P[] };
    const watches = (j.products ?? [])
      .filter((p) => /워치|시계/.test(p.product_name) && !/밴드|스트랩|팔찌|귀걸이|목걸이|반지|조절기|쇼핑백/.test(p.product_name))
      .map((p) => ({ no: p.product_no, name: p.product_name, image: p.list_image ?? null }));
    return Response.json({ ok: true, products: watches });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
