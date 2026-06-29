import { syncCafe24Boards } from "@/lib/cs/cafe24BoardIngest";
import { maybeAutoReplyOffHours } from "@/lib/cs/crispAutoReply";
import { type MallId } from "@/lib/cafe24Client";

export const maxDuration = 90;
export const dynamic = "force-dynamic";

const MALLS: MallId[] = ["paulvice", "harriot"];

async function run() {
  // 두 몰(폴바이스+해리엇) CS 게시판 각각 ingest — 한 몰 실패해도 다른 몰 진행.
  const malls: Record<string, unknown> = {};
  const newThreads: string[] = [];
  let ok = true;
  for (const mall of MALLS) {
    try {
      const res = await syncCafe24Boards(mall);
      malls[mall] = res;
      newThreads.push(...(res.newInboundThreadIds ?? []));
    } catch (err) {
      ok = false;
      malls[mall] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  // 새로 들어온 게시판 고객 질문 → 자동응대(게시판은 항상 텔레그램 확인 후 등록). 비차단·실패무시.
  let escalated = 0;
  for (const threadId of newThreads) {
    try {
      const r = await maybeAutoReplyOffHours(threadId);
      if (r.reason === "needs_confirmation") escalated++;
    } catch (e) {
      console.warn("[cafe24-board] 자동응대 트리거 실패:", e instanceof Error ? e.message : String(e));
    }
  }
  return Response.json({ ok, malls, newThreads: newThreads.length, escalated });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  return run();
}

export async function POST() {
  return run();
}
