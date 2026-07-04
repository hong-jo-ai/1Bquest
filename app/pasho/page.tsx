import PashoClient from "@/components/PashoClient";
import { getOrdersWithBalance } from "@/lib/pasho/store";

export const dynamic = "force-dynamic";

export default async function PashoPage() {
  const orders = await getOrdersWithBalance();
  return <PashoClient orders={orders} />;
}
