import AppHeader from "@/components/AppHeader";
import MetaAdsDashboard from "@/components/MetaAdsDashboard";
import { getMetaAdsData } from "@/lib/metaData";
import { getMetaTokenServer } from "@/lib/metaTokenStore";

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const metaToken    = await getMetaTokenServer();
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
    <>
      <AppHeader refreshHref="/ads" />
      <MetaAdsDashboard
        metaData={metaData}
        isConnected={isConnected}
        error={metaError ?? urlError}
      />
    </>
  );
}
