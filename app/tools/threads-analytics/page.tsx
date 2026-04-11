import AppHeader from "@/components/AppHeader";
import ThreadsAnalyticsDashboard from "@/components/threads/ThreadsAnalyticsDashboard";

export default function ThreadsAnalyticsPage() {
  return (
    <>
      <AppHeader refreshHref="/tools/threads-analytics" />
      <ThreadsAnalyticsDashboard />
    </>
  );
}
