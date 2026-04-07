import AppHeader from "@/components/AppHeader";
import ThreadsStudio from "@/components/threads/ThreadsStudio";
import type { BrandId } from "@/lib/threadsBrands";

export default async function ThreadsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand } = await searchParams;
  const validBrands: BrandId[] = ["paulvice", "harriot", "hongsungjo"];
  const activeBrand = validBrands.includes(brand as BrandId) ? (brand as BrandId) : "paulvice";

  return (
    <>
      <AppHeader refreshHref={`/tools/threads?brand=${activeBrand}`} />
      <ThreadsStudio initialBrand={activeBrand} />
    </>
  );
}
