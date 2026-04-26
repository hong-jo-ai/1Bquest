import AppHeader from "@/components/AppHeader";
import FinanceClient from "@/components/finance/FinanceClient";

export const dynamic = "force-dynamic";

export default function FinancePage() {
  return (
    <>
      <AppHeader refreshHref="/finance" />
      <FinanceClient />
    </>
  );
}
