import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { parseHometaxExcel, categorizeInvoice, type TaxInvoiceType } from "@/lib/finance/hometaxParser";

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

  const typeParam = req.nextUrl.searchParams.get("type") as TaxInvoiceType | null;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "multipart/form-data 파싱 실패" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) return Response.json({ error: "file 필드가 없습니다" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "파일 크기 10MB 초과" }, { status: 413 });

  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = parseHometaxExcel(buffer, typeParam ?? undefined);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }

  const businessId = await getDefaultBusinessId();
  if (!businessId) {
    return Response.json({ error: "기본 사업자가 없습니다" }, { status: 500 });
  }

  // 사업자 등록번호 자동 업데이트
  if (parsed.myBusinessRegNo) {
    await db
      .from("finance_businesses")
      .update({ registration_number: parsed.myBusinessRegNo })
      .eq("id", businessId)
      .is("registration_number", null);
  }

  // 품목을 승인번호별로 그룹핑
  const itemsByApproval: Record<string, typeof parsed.items> = {};
  for (const it of parsed.items) {
    if (!itemsByApproval[it.approvalNo]) itemsByApproval[it.approvalNo] = [];
    itemsByApproval[it.approvalNo].push(it);
  }

  // 인보이스 upsert
  const invoiceRecords = parsed.invoices.map((inv) => {
    const its = itemsByApproval[inv.approvalNo] ?? [];
    const cat = categorizeInvoice(inv, its);
    return {
      business_id: businessId,
      invoice_type: parsed.invoiceType,
      approval_no: inv.approvalNo,
      write_date: inv.writeDate,
      issue_date: inv.issueDate,
      partner_reg_no: inv.partnerRegNo,
      partner_name: inv.partnerName,
      partner_rep: inv.partnerRep,
      partner_address: inv.partnerAddress,
      supply_amount: inv.supplyAmount,
      tax_amount: inv.taxAmount,
      total_amount: inv.totalAmount,
      category: cat,
      category_source: "rule",
      raw: inv,
    };
  });

  const { data: upserted, error: invErr } = await db
    .from("finance_tax_invoices")
    .upsert(invoiceRecords, {
      onConflict: "business_id,approval_no",
      ignoreDuplicates: false,
    })
    .select("id, approval_no");

  if (invErr) return Response.json({ error: invErr.message }, { status: 500 });

  // 품목 삽입 (인보이스 ID 매핑 후)
  const approvalToId: Record<string, string> = {};
  for (const u of upserted ?? []) {
    approvalToId[u.approval_no as string] = u.id as string;
  }

  // 기존 품목 삭제 후 재삽입 (동일 인보이스 재업로드 시 일관성)
  const invoiceIds = Object.values(approvalToId);
  if (invoiceIds.length > 0) {
    await db.from("finance_tax_invoice_items").delete().in("invoice_id", invoiceIds);
  }

  const itemRecords = parsed.items
    .filter((it) => approvalToId[it.approvalNo])
    .map((it) => ({
      invoice_id: approvalToId[it.approvalNo],
      item_seq: it.itemSeq,
      item_date: it.itemDate,
      item_name: it.itemName,
      spec: it.spec,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      supply_amount: it.supplyAmount,
      tax_amount: it.taxAmount,
      remark: it.remark,
    }));

  if (itemRecords.length > 0) {
    const { error: itErr } = await db.from("finance_tax_invoice_items").insert(itemRecords);
    if (itErr) {
      console.error("[tax-invoices] item 삽입 실패:", itErr.message);
    }
  }

  return Response.json({
    ok: true,
    invoiceType: parsed.invoiceType,
    detectedBusinessRegNo: parsed.myBusinessRegNo,
    detectedBusinessName: parsed.myBusinessName,
    invoicesUpserted: upserted?.length ?? 0,
    itemsInserted: itemRecords.length,
    totalSupply: parsed.totalSupply,
    totalTax: parsed.totalTax,
    totalAmount: parsed.totalAmount,
  });
}

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return Response.json({ error: "Supabase 미설정" }, { status: 500 });

  const type = req.nextUrl.searchParams.get("type"); // 'purchase' / 'sales' / null=both
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10), 1000);

  let q = db
    .from("finance_tax_invoices")
    .select("id, invoice_type, write_date, partner_name, partner_reg_no, supply_amount, tax_amount, total_amount, category")
    .order("write_date", { ascending: false })
    .limit(limit);

  if (type) q = q.eq("invoice_type", type);

  const { data, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // 거래처별 집계
  const partnerAgg: Record<string, { name: string; total: number; count: number; type: string }> = {};
  for (const r of data ?? []) {
    const key = `${r.invoice_type}|${r.partner_reg_no}`;
    if (!partnerAgg[key]) {
      partnerAgg[key] = { name: r.partner_name as string, total: 0, count: 0, type: r.invoice_type as string };
    }
    partnerAgg[key].total += Number(r.total_amount) || 0;
    partnerAgg[key].count += 1;
  }

  return Response.json({
    ok: true,
    invoices: data ?? [],
    partnerAggregate: Object.values(partnerAgg).sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
  });
}
