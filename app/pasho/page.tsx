import PashoClient from "@/components/PashoClient";
import { getOrdersWithBalance } from "@/lib/pasho/store";
import { listDocs } from "@/lib/pasho/docs";
import type { PashoDoc } from "@/components/PashoDocs";

export const dynamic = "force-dynamic";

export default async function PashoPage() {
  const [orders, docs] = await Promise.all([getOrdersWithBalance(), listDocs()]);
  return <PashoClient orders={orders} docs={docs as PashoDoc[]} />;
}
