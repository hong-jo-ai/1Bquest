import AppHeader from "@/components/AppHeader";
import InventoryManager from "@/components/inventory/InventoryManager";
import PurchaseOrderManager from "@/components/PurchaseOrderManager";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";

export default async function InventoryPage() {
  const isAuthenticated = !!(await readRefreshTokenFromStore());

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref="/inventory" />
      <InventoryManager />
      <div className="border-t border-zinc-200 dark:border-zinc-800 mt-2">
        <PurchaseOrderManager />
      </div>
    </>
  );
}
