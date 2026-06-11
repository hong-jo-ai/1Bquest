import AppHeader from "@/components/AppHeader";
import InventoryManager from "@/components/inventory/InventoryManager";
import SuppliesManager from "@/components/inventory/SuppliesManager";
import PurchaseOrderManager from "@/components/PurchaseOrderManager";
import UpcomingProducts from "@/components/inventory/UpcomingProducts";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";

export default async function InventoryPage() {
  const isAuthenticated = !!(await readRefreshTokenFromStore());

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref="/inventory" />
      <UpcomingProducts />
      <div className="border-t border-zinc-200 dark:border-zinc-800 mt-2">
        <PurchaseOrderManager />
      </div>
      <div className="border-t border-zinc-200 dark:border-zinc-800 mt-2">
        <InventoryManager />
      </div>
      <div className="border-t border-zinc-200 dark:border-zinc-800 mt-2">
        <SuppliesManager />
      </div>
    </>
  );
}
