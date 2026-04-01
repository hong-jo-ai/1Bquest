import { cafe24Get, doRefresh } from "@/lib/cafe24Client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

async function fetchAllProducts(token: string) {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    // embed=categories 로 카테고리 정보 포함 요청
    const data = await cafe24Get(
      `/api/v2/admin/products?limit=100&display=T&offset=${offset}&embed=categories`,
      token
    );
    const batch: any[] = data.products ?? [];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return all;
}

async function fetchCategoryMap(token: string): Promise<Record<number, string>> {
  try {
    // shop_no=1 명시, 최상위 포함 전체 카테고리 조회
    const data = await cafe24Get(
      "/api/v2/admin/categories?limit=200&shop_no=1",
      token
    );
    const map: Record<number, string> = {};
    for (const cat of (data.categories ?? [])) {
      if (cat.category_no && cat.category_name) {
        map[Number(cat.category_no)] = cat.category_name;
      }
    }
    return map;
  } catch {
    return {};
  }
}

export async function GET() {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("c24_at")?.value;
  const refreshToken = cookieStore.get("c24_rt")?.value;

  if (!accessToken && refreshToken) {
    try {
      const newToken = await doRefresh(refreshToken);
      accessToken = newToken.access_token;
      cookieStore.set("c24_at", newToken.access_token, {
        httpOnly: true, secure: true,
        maxAge: newToken.expires_in ?? 7200,
        path: "/", sameSite: "lax",
      });
      cookieStore.set("c24_rt", newToken.refresh_token, {
        httpOnly: true, secure: true,
        maxAge: 60 * 60 * 24 * 14,
        path: "/", sameSite: "lax",
      });
    } catch {
      return NextResponse.json({ error: "refresh_failed" }, { status: 401 });
    }
  }

  if (!accessToken) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  try {
    const [raw, catMap] = await Promise.all([
      fetchAllProducts(accessToken),
      fetchCategoryMap(accessToken),
    ]);

    // 디버그: 첫 번째 상품의 원본 데이터 확인
    const firstRaw = raw[0];
    const debugInfo = firstRaw ? {
      categories_field: firstRaw.categories,
      display_group_field: firstRaw.display_group,
      category_name_field: firstRaw.category_name,
      catMapSize: Object.keys(catMap).length,
    } : null;

    const products = raw.map((p: any) => {
      // 1순위: embed된 categories 배열의 category_name
      const embeddedCatName = Array.isArray(p.categories) && p.categories.length > 0
        ? (p.categories[0]?.category_name ?? "")
        : "";

      // 2순위: category_no → catMap 조회
      const catNoLookup = (() => {
        const nos = Array.isArray(p.categories) ? p.categories : [];
        for (const c of nos) {
          const no = Number(c?.category_no);
          if (no && catMap[no]) return catMap[no];
        }
        return "";
      })();

      // 3순위: display_group (문자열인 경우만)
      const displayGroup = typeof p.display_group === "string" && p.display_group.trim()
        ? p.display_group.trim()
        : "";

      const category = embeddedCatName || catNoLookup || displayGroup;

      return {
        sku: p.product_code ?? String(p.product_no),
        name: p.product_name,
        image: p.list_image ?? p.small_image ?? p.detail_image ?? "",
        category,
        isManual: false,
      };
    });

    return NextResponse.json({ products, _debug: debugInfo });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
