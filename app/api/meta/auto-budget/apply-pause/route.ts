import { metaPost } from "@/lib/metaClient";
import { getMetaTokenServer } from "@/lib/metaTokenStore";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  const token = await getMetaTokenServer();
  if (!token) return Response.json({ ok: false, error: "Meta 미연결" }, { status: 401 });

  const supabase = getSupabase();
  if (!supabase) return Response.json({ ok: false, error: "Supabase 미연결" }, { status: 500 });

  let body: { adsetIds?: unknown };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "잘못된 요청" }, { status: 400 }); }

  const ids = Array.isArray(body.adsetIds)
    ? body.adsetIds.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  if (ids.length === 0) return Response.json({ ok: false, error: "adsetIds 비어있음" }, { status: 400 });

  // Meta API 순차 호출 (rate limit + 에러 분리)
  const results: Array<{ adsetId: string; ok: boolean; error?: string }> = [];
  for (const id of ids) {
    try {
      await metaPost(`/${id}`, token, { status: "PAUSED" });
      results.push({ adsetId: id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[apply-pause] ${id} 실패:`, msg);
      results.push({ adsetId: id, ok: false, error: msg });
    }
  }

  // 성공한 항목 → DB의 가장 최근 pause 추천 행에 applied=true 마킹
  const succeeded = results.filter((r) => r.ok).map((r) => r.adsetId);
  const appliedAt = new Date().toISOString();
  for (const adsetId of succeeded) {
    const { data: latest } = await supabase
      .from("meta_auto_budget_log")
      .select("id")
      .eq("adset_id", adsetId)
      .eq("action", "pause")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest?.id) {
      await supabase
        .from("meta_auto_budget_log")
        .update({ applied: true, applied_at: appliedAt })
        .eq("id", latest.id);
    }
  }

  return Response.json({
    ok: true,
    requested: ids.length,
    succeeded: succeeded.length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
