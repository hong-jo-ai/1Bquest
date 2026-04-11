import AppHeader from "@/components/AppHeader";
import ThreadsStudio from "@/components/threads/ThreadsStudio";
import ThreadsAnalyticsDashboard from "@/components/threads/ThreadsAnalyticsDashboard";
import type { BrandId } from "@/lib/threadsBrands";

type ThreadsView = "dashboard" | BrandId;

export default async function ThreadsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand } = await searchParams;
  const validViews: ThreadsView[] = ["dashboard", "paulvice", "harriot", "hongsungjo"];
  const activeView: ThreadsView = validViews.includes(brand as ThreadsView) ? (brand as ThreadsView) : "dashboard";

  return (
    <>
      <AppHeader refreshHref={`/tools/threads?brand=${activeView}`} />
      {activeView === "dashboard"
        ? <ThreadsAnalyticsDashboard />
        : <ThreadsStudio initialBrand={activeView} />
      }
    </>
  );
}
