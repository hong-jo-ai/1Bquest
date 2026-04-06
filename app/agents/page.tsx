import { cookies } from "next/headers";
import AppHeader from "@/components/AppHeader";
import AgentDashboard from "@/components/agents/AgentDashboard";

export default async function AgentsPage() {
  const cookieStore = await cookies();
  const isAuthenticated = !!(
    cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value
  );

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref="/agents" />
      <AgentDashboard />
    </>
  );
}
