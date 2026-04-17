import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  GbCampaign,
  GbOrder,
  GbPriceCheck,
  GbProduct,
  GbSettlement,
  GbStatus,
} from "./types";

// ── Supabase 클라이언트 ──────────────────────────────────────────────

let cached: SupabaseClient | null = null;

export function getGbSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수 누락");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

// ── 캠페인 CRUD ──────────────────────────────────────────────────────

export async function listCampaigns(opts?: {
  status?: GbStatus | "all";
  search?: string;
  limit?: number;
}): Promise<GbCampaign[]> {
  const db = getGbSupabase();
  let q = db
    .from("gb_campaigns")
    .select("*, gb_products(*)")
    .order("updated_at", { ascending: false })
    .limit(opts?.limit ?? 100);

  if (opts?.status && opts.status !== "all") {
    q = q.eq("status", opts.status);
  }
  if (opts?.search) {
    q = q.or(
      `title.ilike.%${opts.search}%,influencer_handle.ilike.%${opts.search}%,influencer_name.ilike.%${opts.search}%`
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(`listCampaigns: ${error.message}`);
  return ((data ?? []) as any[]).map((c) => ({
    ...c,
    products: c.gb_products ?? [],
    gb_products: undefined,
  })) as GbCampaign[];
}

export async function getCampaign(id: string): Promise<GbCampaign | null> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_campaigns")
    .select("*, gb_products(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getCampaign: ${error.message}`);
  if (!data) return null;
  return {
    ...(data as any),
    products: (data as any).gb_products ?? [],
    gb_products: undefined,
  } as GbCampaign;
}

export async function createCampaign(
  input: Omit<GbCampaign, "id" | "created_at" | "updated_at" | "products" | "order_count" | "total_revenue" | "total_quantity">
): Promise<GbCampaign> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_campaigns")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(`createCampaign: ${error.message}`);
  return { ...(data as any), products: [] } as GbCampaign;
}

export async function updateCampaign(
  id: string,
  patch: Partial<Omit<GbCampaign, "id" | "created_at" | "updated_at" | "products">>
): Promise<GbCampaign> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_campaigns")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateCampaign: ${error.message}`);
  return data as GbCampaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  const db = getGbSupabase();
  const { error } = await db.from("gb_campaigns").delete().eq("id", id);
  if (error) throw new Error(`deleteCampaign: ${error.message}`);
}

// ── 상품 CRUD ────────────────────────────────────────────────────────

export async function listProducts(campaignId: string): Promise<GbProduct[]> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_products")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listProducts: ${error.message}`);
  return (data ?? []) as GbProduct[];
}

export async function createProduct(
  input: Omit<GbProduct, "id" | "created_at" | "updated_at">
): Promise<GbProduct> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_products")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(`createProduct: ${error.message}`);
  return data as GbProduct;
}

export async function updateProduct(
  id: string,
  patch: Partial<Omit<GbProduct, "id" | "campaign_id" | "created_at" | "updated_at">>
): Promise<GbProduct> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_products")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateProduct: ${error.message}`);
  return data as GbProduct;
}

export async function deleteProduct(id: string): Promise<void> {
  const db = getGbSupabase();
  const { error } = await db.from("gb_products").delete().eq("id", id);
  if (error) throw new Error(`deleteProduct: ${error.message}`);
}

// ── 주문 CRUD ────────────────────────────────────────────────────────

export async function listOrders(campaignId: string): Promise<GbOrder[]> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_orders")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listOrders: ${error.message}`);
  return (data ?? []) as GbOrder[];
}

export async function createOrder(
  input: Omit<GbOrder, "id" | "created_at" | "updated_at">
): Promise<GbOrder> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_orders")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(`createOrder: ${error.message}`);
  return data as GbOrder;
}

export async function updateOrder(
  id: string,
  patch: Partial<Omit<GbOrder, "id" | "campaign_id" | "created_at" | "updated_at">>
): Promise<GbOrder> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_orders")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateOrder: ${error.message}`);
  return data as GbOrder;
}

export async function bulkImportOrders(
  orders: Omit<GbOrder, "id" | "created_at" | "updated_at">[]
): Promise<{ inserted: number; skipped: number }> {
  if (orders.length === 0) return { inserted: 0, skipped: 0 };
  const db = getGbSupabase();

  const cafe24Ids = orders
    .map((o) => o.cafe24_order_id)
    .filter(Boolean) as string[];

  let existingIds = new Set<string>();
  if (cafe24Ids.length > 0) {
    const { data } = await db
      .from("gb_orders")
      .select("cafe24_order_id")
      .in("cafe24_order_id", cafe24Ids);
    existingIds = new Set((data ?? []).map((r) => r.cafe24_order_id));
  }

  const newOrders = orders.filter(
    (o) => !o.cafe24_order_id || !existingIds.has(o.cafe24_order_id)
  );

  if (newOrders.length > 0) {
    const { error } = await db.from("gb_orders").insert(newOrders);
    if (error) throw new Error(`bulkImportOrders: ${error.message}`);
  }

  return { inserted: newOrders.length, skipped: orders.length - newOrders.length };
}

// ── 정산 ─────────────────────────────────────────────────────────────

export async function getSettlement(campaignId: string): Promise<GbSettlement | null> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_settlements")
    .select("*")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (error) throw new Error(`getSettlement: ${error.message}`);
  return data as GbSettlement | null;
}

export async function calculateSettlement(
  campaignId: string,
  extra?: { shipping_cost?: number; product_cost?: number; notes?: string }
): Promise<GbSettlement> {
  const db = getGbSupabase();

  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error("캠페인을 찾을 수 없습니다");

  const orders = await listOrders(campaignId);

  const validOrders = orders.filter((o) => !o.is_returned);
  const returnedOrders = orders.filter((o) => o.is_returned);

  const totalRevenue = validOrders.reduce((s, o) => s + o.total_amount, 0);
  const totalQuantity = validOrders.reduce((s, o) => s + o.quantity, 0);
  const returnAmount = returnedOrders.reduce((s, o) => s + o.total_amount, 0);
  const netRevenue = totalRevenue - returnAmount;

  let commissionAmount = 0;
  if (campaign.commission_type === "rate" && campaign.commission_rate) {
    commissionAmount = Math.round(netRevenue * campaign.commission_rate / 100);
  } else if (campaign.commission_type === "fixed_per_unit" && campaign.commission_fixed_amount) {
    commissionAmount = totalQuantity * campaign.commission_fixed_amount;
  }

  const shippingCost = extra?.shipping_cost ?? 0;
  const productCost = extra?.product_cost ?? 0;
  const netProfit = netRevenue - commissionAmount - shippingCost - productCost;

  const settlement = {
    campaign_id: campaignId,
    total_revenue: totalRevenue,
    total_quantity: totalQuantity,
    return_amount: returnAmount,
    net_revenue: netRevenue,
    commission_amount: commissionAmount,
    shipping_cost: shippingCost,
    product_cost: productCost,
    net_profit: netProfit,
    settled_at: new Date().toISOString(),
    notes: extra?.notes ?? null,
    receipt_url: null,
  };

  const existing = await getSettlement(campaignId);
  if (existing) {
    const { data, error } = await db
      .from("gb_settlements")
      .update(settlement)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(`updateSettlement: ${error.message}`);
    return data as GbSettlement;
  }

  const { data, error } = await db
    .from("gb_settlements")
    .insert(settlement)
    .select("*")
    .single();
  if (error) throw new Error(`createSettlement: ${error.message}`);
  return data as GbSettlement;
}

// ── 최저가 비교 ──────────────────────────────────────────────────────

export async function listPriceChecks(campaignId: string): Promise<GbPriceCheck[]> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_price_checks")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("checked_at", { ascending: false });
  if (error) throw new Error(`listPriceChecks: ${error.message}`);
  return (data ?? []) as GbPriceCheck[];
}

export async function savePriceCheck(
  input: Omit<GbPriceCheck, "id">
): Promise<GbPriceCheck> {
  const db = getGbSupabase();
  const { data, error } = await db
    .from("gb_price_checks")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(`savePriceCheck: ${error.message}`);
  return data as GbPriceCheck;
}

// ── 통계 ─────────────────────────────────────────────────────────────

export async function getCampaignStats(): Promise<{
  total: number;
  active: number;
  totalRevenue: number;
  avgCommission: number;
}> {
  const db = getGbSupabase();

  const { data: campaigns, error } = await db
    .from("gb_campaigns")
    .select("id, status, commission_rate");
  if (error) throw new Error(`getCampaignStats: ${error.message}`);

  const all = campaigns ?? [];
  const activeCampaigns = all.filter((c) => c.status === "active");
  const rates = all
    .map((c) => c.commission_rate)
    .filter((r): r is number => r != null);

  const { data: settlements } = await db
    .from("gb_settlements")
    .select("total_revenue");
  const totalRevenue = (settlements ?? []).reduce(
    (s, r) => s + (r.total_revenue ?? 0),
    0
  );

  return {
    total: all.length,
    active: activeCampaigns.length,
    totalRevenue,
    avgCommission: rates.length > 0
      ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10
      : 0,
  };
}
