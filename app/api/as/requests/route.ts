import {
  createAsRequest,
  listAsRequests,
  countAsByStatus,
} from "@/lib/as/store";
import type { AsStatus, AsDestination } from "@/lib/as/types";
import type { CsBrandId } from "@/lib/cs/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "all") as AsStatus | "all";
  const brand = (url.searchParams.get("brand") ?? "all") as CsBrandId | "all";
  const q = url.searchParams.get("q") ?? undefined;

  try {
    const [requests, counts] = await Promise.all([
      listAsRequests({ status, brand, q }),
      countAsByStatus({ brand }),
    ]);
    return Response.json({ requests, counts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const brand = body.brand as CsBrandId;
    if (brand !== "paulvice" && brand !== "harriot") {
      return Response.json({ error: "brand 누락 또는 잘못됨" }, { status: 400 });
    }
    const request = await createAsRequest({
      brand,
      customerName: body.customerName ?? null,
      customerPhone: body.customerPhone ?? null,
      channel: body.channel ?? null,
      model: body.model ?? null,
      symptom: body.symptom ?? null,
      destination: (body.destination ?? null) as AsDestination | null,
      note: body.note ?? null,
      csThreadId: body.csThreadId ?? null,
    });
    return Response.json({ request });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
