import { getDashboardData, getMallShopData } from "@/lib/cafe24Data";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";
import { USD_TO_KRW } from "@/lib/finance/forex";
import AppHeader from "@/components/AppHeader";
import DashboardClient from "@/components/DashboardClient";
import type { Brand, MultiChannelData } from "@/lib/multiChannelData";

interface PageProps {
  searchParams: Promise<{ brand?: string }>;
}

export default async function Dashboard({ searchParams }: PageProps) {
  const params = await searchParams;
  const brand: Brand = params.brand === "harriot" ? "harriot" : "paulvice";

  const hasAnyToken     = !!(await readRefreshTokenFromStore());
  const isAuthenticated = hasAnyToken;

  let data         = null; // 폴바이스 cafe24
  let harriotData  = null; // 해리엇 cafe24 국내몰(shop_no=1)
  let harriotGlobalData: MultiChannelData | null = null; // 해리엇 cafe24 글로벌 영문몰(shop_no=2)
  let apiError: string | null = null;

  // 전사 KPI는 두 cafe24 몰(폴바이스+해리엇)을 모두 합산해야 하므로 둘 다 불러온다.
  if (isAuthenticated) {
    const token = await getValidC24Token("paulvice");
    if (token) {
      try {
        data = await getDashboardData(token, "paulvice");
      } catch (e: unknown) {
        apiError = e instanceof Error ? e.message : "카페24 데이터를 불러오지 못했습니다.";
      }
    } else {
      apiError = "카페24 토큰이 만료되었습니다. 재연결이 필요합니다.";
    }
    // 해리엇 cafe24 — 연결돼 있으면 함께 로드(실패해도 폴바이스/페이지에 영향 없음)
    // 국내몰(shop_no=1)과 글로벌 영문몰(shop_no=2, USD→KRW)을 각각 별도 채널로.
    try {
      const hToken = await getValidC24Token("harriot");
      if (hToken) {
        harriotData = await getDashboardData(hToken, "harriot");
        try {
          harriotGlobalData = await getMallShopData(hToken, "harriot", 2, { usdToKrw: USD_TO_KRW });
        } catch (ge) {
          console.warn("[dashboard] 해리엇 글로벌(shop2) 로드 실패:", ge instanceof Error ? ge.message : ge);
        }
      }
    } catch (e) {
      console.warn("[dashboard] 해리엇 cafe24 로드 실패:", e instanceof Error ? e.message : e);
    }
  }

  const now = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year:   "numeric",
    month:  "long",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref={`/?brand=${brand}`} />
      <DashboardClient
        brand={brand}
        cafe24Data={data}
        harriotCafe24Data={harriotData}
        harriotGlobalCafe24Data={harriotGlobalData}
        isAuthenticated={isAuthenticated}
        apiError={apiError}
        now={now}
      />
    </>
  );
}
