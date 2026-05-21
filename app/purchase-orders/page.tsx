import AppHeader from "@/components/AppHeader";
import PurchaseOrderManager from "@/components/PurchaseOrderManager";

export const dynamic = "force-dynamic";

export default function PurchaseOrdersPage() {
  return (
    <>
      <AppHeader refreshHref="/purchase-orders" />
      <PurchaseOrderManager />
    </>
  );
}
