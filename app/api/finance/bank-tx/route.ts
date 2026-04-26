import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { parseKbBankExcel } from "@/lib/finance/kbParser";
import { categorizeTx } from "@/lib/finance/categorize";

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
  if (!db) {
    return Response.json({ error: "Supabase 미설정" }, { status: 500 });
  }

  const bank = req.nextUrl.searchParams.get("bank") ?? "KB";
  if (bank !== "KB") {
    return Response.json(
      { error: `지원하지 않는 은행: ${bank} (현재 KB만 지원)` },
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
  if (!file) {
    return Response.json({ error: "file 필드가 없습니다" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: "파일 크기 10MB 초과" }, { status: 413 });
  }

  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = parseKbBankExcel(buffer);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 422 }
    );
  }

  const businessId = await getDefaultBusinessId();
  if (!businessId) {
    return Response.json(
      { error: "기본 사업자가 없습니다. finance_businesses 테이블 확인 필요." },
      { status: 500 }
    );
  }

  // 분류 + 삽입 페이로드 준비
  const records = parsed.rows.map((r) => {
    const cat = categorizeTx(r);
    return {
      business_id: businessId,
      bank,
      account_number: parsed.accountNumber,
      tx_date: r.txDate.toISOString(),
      description: r.description,
      counterparty: r.counterparty,
      memo: r.memo,
      withdrawal: r.withdrawal,
      deposit: r.deposit,
      balance: r.balance,
      branch: r.branch,
      category: cat.category,
      category_source: cat.source,
      raw: r,
    };
  });

  // 중복 방지: (business_id, tx_date, withdrawal, deposit, balance) unique 제약
  const { data, error } = await db
    .from("finance_bank_tx")
    .upsert(records, {
      onConflict: "business_id,tx_date,withdrawal,deposit,balance",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    parsed: parsed.rows.length,
    inserted: data?.length ?? 0,
    skipped: parsed.rows.length - (data?.length ?? 0),
    rangeStart: parsed.rangeStart,
    rangeEnd: parsed.rangeEnd,
    accountNumber: parsed.accountNumber,
  });
}

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) {
    return Response.json({ error: "Supabase 미설정" }, { status: 500 });
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10), 1000);
  const category = req.nextUrl.searchParams.get("category");

  let q = db
    .from("finance_bank_tx")
    .select("id, bank, tx_date, description, counterparty, memo, withdrawal, deposit, balance, category, category_source")
    .order("tx_date", { ascending: false })
    .limit(limit);

  if (category && category !== "all") {
    q = q.eq("category", category);
  }

  const { data, error } = await q;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // 카테고리별 집계 (전체 기간)
  const { data: aggRows } = await db
    .from("finance_bank_tx")
    .select("category, withdrawal, deposit");

  const agg: Record<string, { withdrawal: number; deposit: number; count: number }> = {};
  for (const r of aggRows ?? []) {
    const c = (r.category as string) ?? "기타";
    if (!agg[c]) agg[c] = { withdrawal: 0, deposit: 0, count: 0 };
    agg[c].withdrawal += Number(r.withdrawal) || 0;
    agg[c].deposit += Number(r.deposit) || 0;
    agg[c].count += 1;
  }

  return Response.json({ ok: true, transactions: data ?? [], aggregate: agg });
}

export async function PATCH(req: NextRequest) {
  // 카테고리 수동 변경
  const db = getDb();
  if (!db) {
    return Response.json({ error: "Supabase 미설정" }, { status: 500 });
  }
  const body = await req.json() as { id?: string; category?: string };
  if (!body.id || !body.category) {
    return Response.json({ error: "id, category 필수" }, { status: 400 });
  }
  const { error } = await db
    .from("finance_bank_tx")
    .update({ category: body.category, category_source: "manual" })
    .eq("id", body.id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
