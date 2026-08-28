import { getThread, setThreadStatus } from "@/lib/cs/store";
import { getReturnByThread } from "@/lib/cs/sixshopIngest";
import { listPromisesByThread } from "@/lib/cs/promises";
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
    // 반품 스레드면 라이프사이클/액션용 cs_returns 동봉
    const csReturn = result.thread.item_type === "return" ? await getReturnByThread(id) : null;
    // 이 대화에서 한 약속(쇼핑백 동봉 등) — 저장 실패로 스레드 자체가 안 열리면 안 되니 조용히 비운다.
    const csPromises = await listPromisesByThread(id).catch(() => []);
    return Response.json({ ...result, csReturn, csPromises });
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
