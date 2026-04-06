import { cookies } from "next/headers";
import AppHeader from "@/components/AppHeader";
import JewelryClearance from "@/components/inventory/JewelryClearance";

export default async function JewelryClearancePage() {
  const cookieStore = await cookies();
  const isAuthenticated = !!(
    cookieStore.get("c24_at")?.value || cookieStore.get("c24_rt")?.value
  );

  return (
    <>
      <AppHeader isAuthenticated={isAuthenticated} refreshHref="/jewelry-clearance" />
      <div className="max-w-7xl mx-auto px-6 py-8">
        <JewelryClearance />
      </div>
    </>
  );
}
