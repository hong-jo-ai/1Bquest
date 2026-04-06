import { cookies } from "next/headers";
import AppHeader from "@/components/AppHeader";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";

export default async function AnalyticsPage() {
  const cookieStore = await cookies();
  const isAuthenticated = !!(
    cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value
  );
  const hasGaToken   = !!(cookieStore.get("ga_at")?.value || cookieStore.get("ga_rt")?.value);
  const ga4PropertyId = cookieStore.get("ga4_prop")?.value ?? process.env.GA4_PROPERTY_ID ?? "";

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref="/analytics" />
      <AnalyticsDashboard
        isAuthenticated={isAuthenticated}
        hasGaToken={hasGaToken}
        ga4PropertyId={ga4PropertyId}
      />
    </>
  );
}
