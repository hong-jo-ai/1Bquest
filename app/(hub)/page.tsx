import { getDashboardData } from "@/lib/cafe24Data";
import { getValidC24Token } from "@/lib/cafe24Auth";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";
import AppHeader from "@/components/AppHeader";
import DashboardClient from "@/components/DashboardClient";
import type { Brand } from "@/lib/multiChannelData";

interface PageProps {
  searchParams: Promise<{ brand?: string }>;
}

export default async function Dashboard({ searchParams }: PageProps) {
  const params = await searchParams;
  const brand: Brand = params.brand === "harriot" ? "harriot" : "paulvice";

  const hasAnyToken     = !!(await readRefreshTokenFromStore());
  const isAuthenticated = hasAnyToken;

  let data      = null;
  let apiError: string | null = null;

  // 최상단 전사 KPI에는 폴바이스 카페24 매출도 항상 포함되어야 한다.
  if (isAuthenticated) {
    const token = await getValidC24Token();
    if (token) {
      try {
        data = await getDashboardData(token);
      } catch (e: unknown) {
        apiError = e instanceof Error ? e.message : "카페24 데이터를 불러오지 못했습니다.";
      }
    } else {
      apiError = "카페24 토큰이 만료되었습니다. 재연결이 필요합니다.";
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
        isAuthenticated={isAuthenticated}
        apiError={apiError}
        now={now}
      />
    </>
  );
}
