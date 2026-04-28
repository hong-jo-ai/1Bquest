import { buildBestAdset } from "@/lib/mads/bestAdsetBuilder";
import { getMetaTokenServer } from "@/lib/metaTokenStore";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ReqBody {
  originalAdsetId?: string;
  bestAdId?:        string;
  bestAdName?:      string;
  dailyBudgetKrw?:  number;
}

export async function POST(req: Request) {
  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "Meta 미연결" }, { status: 401 });

  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "잘못된 JSON" }, { status: 400 });
  }

  const { originalAdsetId, bestAdId, bestAdName, dailyBudgetKrw } = body;
  if (!originalAdsetId || !bestAdId || !bestAdName || !dailyBudgetKrw) {
    return Response.json(
      { ok: false, error: "originalAdsetId, bestAdId, bestAdName, dailyBudgetKrw 필수" },
      { status: 400 },
    );
  }
  if (dailyBudgetKrw < 5_000 || dailyBudgetKrw > 5_000_000) {
    return Response.json(
      { ok: false, error: "dailyBudgetKrw 5,000 ~ 5,000,000 범위" },
      { status: 400 },
    );
  }

  try {
    const result = await buildBestAdset(token, {
      originalAdsetId, bestAdId, bestAdName, dailyBudgetKrw,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
