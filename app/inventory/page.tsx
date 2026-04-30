import AppHeader from "@/components/AppHeader";
import InventoryManager from "@/components/inventory/InventoryManager";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";

export default async function InventoryPage() {
  const isAuthenticated = !!(await readRefreshTokenFromStore());

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref="/inventory" />
      <InventoryManager />
    </>
  );
}
