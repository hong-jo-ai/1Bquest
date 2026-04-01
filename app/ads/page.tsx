import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import AppHeader from "@/components/AppHeader";
import MetaAdsDashboard from "@/components/MetaAdsDashboard";
import { getMetaAdsData } from "@/lib/metaData";

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const cookieStore  = await cookies();
  const metaToken    = cookieStore.get("meta_at")?.value;
  const isConnected  = !!metaToken;
  const urlError     = (await searchParams).error ?? null;

  let metaData = null;
  let metaError: string | null = null;

  if (metaToken) {
    try {
      metaData = await getMetaAdsData(metaToken);
    } catch (e: any) {
      metaError = e.message ?? "데이터 조회 실패";
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader activePage="ads" isAuthenticated={false} />
      <MetaAdsDashboard
        metaData={metaData}
        isConnected={isConnected}
        error={metaError ?? urlError}
      />
    </div>
  );
}
