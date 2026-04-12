import { getThread, setThreadStatus } from "@/lib/cs/store";
import type { CsStatus } from "@/lib/cs/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await getThread(id);
    if (!result) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { status?: CsStatus };
  if (!body.status) {
    return Response.json({ error: "status required" }, { status: 400 });
  }
  try {
    await setThreadStatus(id, body.status);
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
