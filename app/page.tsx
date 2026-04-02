import { cookies } from "next/headers";
import { getDashboardData } from "@/lib/cafe24Data";
import { getValidC24Token } from "@/lib/cafe24Auth";
import AppHeader from "@/components/AppHeader";
import DashboardClient from "@/components/DashboardClient";

export default async function Dashboard() {
  const cookieStore   = await cookies();
  const hasAnyToken   = !!(cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value);
  const isAuthenticated = hasAnyToken;

  let data      = null;
  let apiError: string | null = null;

  if (hasAnyToken) {
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader activePage="dashboard" isAuthenticated={isAuthenticated} />
      <DashboardClient
        cafe24Data={data}
        isAuthenticated={isAuthenticated}
        apiError={apiError}
        now={now}
      />
    </div>
  );
}
