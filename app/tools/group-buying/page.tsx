import AppHeader from "@/components/AppHeader";
import GroupBuyingManager from "@/components/group-buying/GroupBuyingManager";

export const metadata = { title: "공동구매 관리 | PAULVICE" };

export default function GroupBuyingPage() {
  return (
    <>
      <AppHeader refreshHref="/tools/group-buying" />
      <GroupBuyingManager />
    </>
  );
}
