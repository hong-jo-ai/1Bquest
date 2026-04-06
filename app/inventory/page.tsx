import { cookies } from "next/headers";
import AppHeader from "@/components/AppHeader";
import InventoryManager from "@/components/inventory/InventoryManager";

export default async function InventoryPage() {
  const cookieStore = await cookies();
  const isAuthenticated = !!(
    cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value
  );

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref="/inventory" />
      <InventoryManager />
    </>
  );
}
