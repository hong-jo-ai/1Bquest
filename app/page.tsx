import { cookies } from "next/headers";
import { getDashboardData } from "@/lib/cafe24Data";
import AppHeader from "@/components/AppHeader";
import DashboardClient from "@/components/DashboardClient";

export default async function Dashboard() {
  const cookieStore = await cookies();
  const accessToken  = cookieStore.get("c24_at")?.value;
  const refreshToken = cookieStore.get("c24_rt")?.value;
  const isAuthenticated = !!(accessToken || refreshToken);

  let data = null;
  let apiError: string | null = null;

  if (accessToken) {
    try {
      data = await getDashboardData(accessToken);
    } catch (e: any) {
      apiError = e.message;
    }
  }

  const now = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
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
