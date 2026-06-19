import { syncCafe24Boards } from "@/lib/cs/cafe24BoardIngest";
import { type MallId } from "@/lib/cafe24Client";

export const maxDuration = 90;
export const dynamic = "force-dynamic";

const MALLS: MallId[] = ["paulvice", "harriot"];

async function run() {
  // 두 몰(폴바이스+해리엇) CS 게시판 각각 ingest — 한 몰 실패해도 다른 몰 진행.
  const malls: Record<string, unknown> = {};
  let ok = true;
  for (const mall of MALLS) {
    try {
      malls[mall] = await syncCafe24Boards(mall);
    } catch (err) {
      ok = false;
      malls[mall] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return Response.json({ ok, malls });
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
