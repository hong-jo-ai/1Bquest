import AppHeader from "@/components/AppHeader";
import JewelryClearance from "@/components/inventory/JewelryClearance";
import { readRefreshTokenFromStore } from "@/lib/cafe24TokenStore";

export default async function JewelryClearancePage() {
  const isAuthenticated = !!(await readRefreshTokenFromStore());

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref="/jewelry-clearance" />
      <div className="max-w-7xl mx-auto px-6 py-8">
        <JewelryClearance />
      </div>
    </>
  );
}
