import { cookies } from "next/headers";
import AppHeader from "@/components/AppHeader";
import InventoryManager from "@/components/inventory/InventoryManager";

export default async function InventoryPage() {
  const cookieStore = await cookies();
  const isAuthenticated = !!(
    cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader activePage="inventory" isAuthenticated={isAuthenticated} />
      <InventoryManager />
    </div>
  );
}
