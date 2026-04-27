/**
 * 외부 광고 플랫폼 일별 광고비 업로드 / 조회.
 *
 * POST /api/finance/ad-spend?source=wconcept   (multipart: file=*.csv)
 *   → { ok, parsed, inserted, updated, total }
 *
 * GET  /api/finance/ad-spend?source=wconcept&days=60
 *   → { ok, daily: [{date, spend}, ...] }
 */
import type { NextRequest } from "next/server";
import { parseWconceptAdsCsv } from "@/lib/finance/wconceptAdsParser";
import {
  mergeAdSpend,
  getAdSpendDaily,
  type AdSource,
} from "@/lib/finance/adSpendStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPPORTED: AdSource[] = ["wconcept", "google", "naver", "kakao"];

function kstDateStr(offsetDays: number = 0): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source") as AdSource | null;
  if (!source || !SUPPORTED.includes(source)) {
    return Response.json(
      { error: `source 쿼리 필수 (지원: ${SUPPORTED.join(", ")})` },
      { status: 400 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "file 필드가 없습니다" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024)
    return Response.json({ error: "파일 크기 10MB 초과" }, { status: 413 });

  let daily: Array<{ date: string; spend: number }> = [];
  try {
    const text = await file.text();
    if (source === "wconcept") {
      daily = parseWconceptAdsCsv(text).rows.map((r) => ({
        date: r.date,
        spend: r.spend,
      }));
    } else {
      return Response.json(
        { error: `${source} 파서 미구현` },
        { status: 501 }
      );
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 }
    );
  }

  try {
    const result = await mergeAdSpend(source, daily);
    return Response.json({
      ok: true,
      parsed: daily.length,
      inserted: result.inserted,
      updated: result.updated,
      total: result.total,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source") as AdSource | null;
  if (!source || !SUPPORTED.includes(source)) {
    return Response.json(
      { ok: false, error: `source 쿼리 필수 (지원: ${SUPPORTED.join(", ")})` },
      { status: 400 }
    );
  }

  const days = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("days") ?? "60", 10), 1),
    365
  );
  const until = kstDateStr(0);
  const since = kstDateStr(-(days - 1));

  try {
    const daily = await getAdSpendDaily(source, since, until);
    return Response.json({ ok: true, daily, since, until });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
