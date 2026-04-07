import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { BRANDS, type BrandId } from "@/lib/threadsBrands";

const THREADS_BASE = "https://graph.threads.net/v1.0";
const VALID_BRANDS: BrandId[] = ["paulvice", "harriot", "hongsungjo"];

export async function GET(req: NextRequest) {
  const brand = (req.nextUrl.searchParams.get("brand") ?? "paulvice") as BrandId;
  if (!VALID_BRANDS.includes(brand)) {
    return Response.json({ connected: false });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(`threads_at_${brand}`)?.value
    || await getThreadsTokenFromStore(brand)
    || null;

  if (!token) {
    return Response.json({ connected: false, brand });
  }

  try {
    const res = await fetch(
      `${THREADS_BASE}/me?fields=id,username&access_token=${token}`,
      { cache: "no-store" }
    );
    if (!res.ok) return Response.json({ connected: false, brand });
    const me = await res.json();
    return Response.json({ connected: true, brand, username: me.username });
  } catch {
    return Response.json({ connected: false, brand });
  }
}
