import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { parseNpayReceiptExcel, categorizeCardUsage } from "@/lib/finance/npayParser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getDefaultBusinessId(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db
    .from("finance_businesses")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();
  return data?.id ?? null;
}

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return Response.json({ error: "Supabase 미설정" }, { status: 500 });

  const source = req.nextUrl.searchParams.get("source");
  if (!source) {
    return Response.json({ error: "source 쿼리 필수 (예: ?source=npay)" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "file 필드가 없습니다" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "파일 크기 10MB 초과" }, { status: 413 });

  const businessId = await getDefaultBusinessId();
  if (!businessId) return Response.json({ error: "기본 사업자가 없습니다" }, { status: 500 });

  let records: Array<Record<string, unknown>> = [];
  try {
    const buffer = await file.arrayBuffer();

    if (source === "npay") {
      const parsed = parseNpayReceiptExcel(buffer);
      records = parsed.rows.map((r) => ({
        business_id: businessId,
        source: "npay",
        card_company: r.cardCompany,
        card_number: r.cardNumber,
        approval_no: r.approvalNo,
        use_date: r.useDate.toISOString(),
        cancel_date: r.cancelDate?.toISOString() ?? null,
        merchant: r.merchant,
        amount: r.amount,
        cancel_amount: r.cancelAmount,
        supply_amount: r.supplyAmount,
        tax_amount: r.taxAmount,
        installment: r.installment,
        category: categorizeCardUsage(r.merchant),
        category_source: "rule",
        raw: r,
      }));
    } else {
      return Response.json(
        { error: `지원하지 않는 source: ${source} (현재 'npay'만 지원)` },
        { status: 400 }
      );
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 }
    );
  }

  const { data, error } = await db
    .from("finance_card_usage")
    .upsert(records, {
      onConflict: "business_id,source,approval_no,use_date",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    parsed: records.length,
    inserted: data?.length ?? 0,
    skipped: records.length - (data?.length ?? 0),
  });
}

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return Response.json({ error: "Supabase 미설정" }, { status: 500 });

  const source = req.nextUrl.searchParams.get("source");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10), 1000);

  let q = db
    .from("finance_card_usage")
    .select("id, source, card_company, use_date, merchant, amount, cancel_amount, category, category_source")
    .order("use_date", { ascending: false })
    .limit(limit);

  if (source) q = q.eq("source", source);

  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 카테고리별 집계
  const agg: Record<string, { total: number; count: number }> = {};
  for (const r of data ?? []) {
    const c = (r.category as string) ?? "기타";
    if (!agg[c]) agg[c] = { total: 0, count: 0 };
    agg[c].total += (Number(r.amount) || 0) - (Number(r.cancel_amount) || 0);
    agg[c].count += 1;
  }

  return Response.json({ ok: true, items: data ?? [], aggregate: agg });
}

export async function PATCH(req: NextRequest) {
  const db = getDb();
  if (!db) return Response.json({ error: "Supabase 미설정" }, { status: 500 });
  const body = (await req.json()) as { id?: string; category?: string };
  if (!body.id || !body.category) return Response.json({ error: "id, category 필수" }, { status: 400 });
  const { error } = await db
    .from("finance_card_usage")
    .update({ category: body.category, category_source: "manual" })
    .eq("id", body.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
