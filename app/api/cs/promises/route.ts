import {
  createPromise,
  deletePromise,
  listPromises,
  setPromiseStatus,
} from "@/lib/cs/promises";

export const dynamic = "force-dynamic";

/** GET /api/cs/promises?includeDone=1 — 약속 목록(기본: 미완료만) */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const includeDone = url.searchParams.get("includeDone") === "1";
    const promises = await listPromises({ includeDone });
    return Response.json({ ok: true, promises });
  } catch (err) {
    return Response.json({ ok: false, error: msg(err) }, { status: 500 });
  }
}

/** POST /api/cs/promises — 약속 등록 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return Response.json({ ok: false, error: "약속 내용을 입력해 주세요" }, { status: 400 });

    const promise = await createPromise({
      text,
      remindOn: str(body.remindOn),
      dueOn: str(body.dueOn),
      orderNumber: str(body.orderNumber),
      seller: str(body.seller),
      threadId: str(body.threadId),
      customerName: str(body.customerName),
      customerHandle: str(body.customerHandle),
    });
    return Response.json({ ok: true, promise });
  } catch (err) {
    return Response.json({ ok: false, error: msg(err) }, { status: 500 });
  }
}

/** PATCH /api/cs/promises — { id, status } 완료/재개 */
export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; status?: string };
    if (!body.id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
    const status = body.status === "open" ? "open" : "done";
    const promise = await setPromiseStatus(body.id, status);
    if (!promise) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, promise });
  } catch (err) {
    return Response.json({ ok: false, error: msg(err) }, { status: 500 });
  }
}

/** DELETE /api/cs/promises?id=... */
export async function DELETE(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
    const removed = await deletePromise(id);
    if (!removed) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: msg(err) }, { status: 500 });
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
