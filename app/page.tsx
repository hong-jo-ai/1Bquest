import { cookies } from "next/headers";
import { getDashboardData } from "@/lib/cafe24Data";
import { getValidC24Token } from "@/lib/cafe24Auth";
import AppHeader from "@/components/AppHeader";
import DashboardClient from "@/components/DashboardClient";
import type { Brand } from "@/lib/multiChannelData";

interface PageProps {
  searchParams: Promise<{ brand?: string }>;
}

export default async function Dashboard({ searchParams }: PageProps) {
  const params = await searchParams;
  const brand: Brand = params.brand === "harriot" ? "harriot" : "paulvice";

  const cookieStore   = await cookies();
  const hasAnyToken   = !!(cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value);
  const isAuthenticated = hasAnyToken;

  let data      = null;
  let apiError: string | null = null;

  // 카페24 데이터는 폴바이스 브랜드일 때만 의미가 있음
  if (hasAnyToken && brand === "paulvice") {
    const token = await getValidC24Token();
    if (token) {
      try {
        data = await getDashboardData(token);
      } catch (e: any) {
        apiError = e.message;
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
