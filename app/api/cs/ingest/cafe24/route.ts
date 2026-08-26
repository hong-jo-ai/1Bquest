import { syncCafe24Boards } from "@/lib/cs/cafe24BoardIngest";
import { maybeAutoReplyOffHours } from "@/lib/cs/crispAutoReply";
import { type MallId } from "@/lib/cafe24Client";

export const maxDuration = 90;
export const dynamic = "force-dynamic";

const MALLS: MallId[] = ["paulvice", "harriot"];

/**
 * `?backfill=1&days=90` — 첨부(사진) 백필 전용 실행.
 * 새 메시지를 넣지 않고 기존 메시지의 raw 에 첨부만 채운다. 첨부 수집 기능을
 * 나중에 붙였기 때문에, 그전에 적재된 글은 이걸 한 번 돌려야 사진이 살아난다.
 */
async function run(opts: { backfillOnly?: boolean; days?: number } = {}) {
  // 두 몰(폴바이스+해리엇) CS 게시판 각각 ingest — 한 몰 실패해도 다른 몰 진행.
  const malls: Record<string, unknown> = {};
  const newThreads: string[] = [];
  let ok = true;
  for (const mall of MALLS) {
    try {
      const res = await syncCafe24Boards(mall, opts);
      malls[mall] = res;
      newThreads.push(...(res.newInboundThreadIds ?? []));
    } catch (err) {
      ok = false;
      malls[mall] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  // 새로 들어온 게시판 고객 질문 → 자동응대(게시판은 항상 텔레그램 확인 후 등록). 비차단·실패무시.
  // 백필 모드는 새 메시지가 없으므로 루프도 안 돈다(옛 글에 자동응대 나가는 사고 방지).
  let escalated = 0;
  for (const threadId of opts.backfillOnly ? [] : newThreads) {
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
  return run(parseOpts(req));
}

export async function POST(req: Request) {
  return run(parseOpts(req));
}

function parseOpts(req: Request): { backfillOnly?: boolean; days?: number } {
  const q = new URL(req.url).searchParams;
  const backfillOnly = q.get("backfill") === "1";
  const days = Number(q.get("days"));
  return {
    backfillOnly,
    // 백필은 기본 90일, 평시 동기화는 기존대로 14일(미지정).
    days: Number.isFinite(days) && days > 0 ? days : backfillOnly ? 90 : undefined,
  };
}
