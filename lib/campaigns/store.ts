/** 캠페인 영속 저장 (Supabase kv_store, 브랜드별). */
import { createClient } from "@supabase/supabase-js";
import type { Campaign, CampaignBrand } from "./types";

const PREFIX = "campaigns:";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function key(brand: CampaignBrand) {
  return `${PREFIX}${brand}`;
}

export async function listCampaigns(brand: CampaignBrand): Promise<Campaign[]> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const { data, error } = await db
    .from("kv_store")
    .select("data")
    .eq("key", key(brand))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.data as Campaign[] | null) ?? [];
}

export async function getCampaign(brand: CampaignBrand, id: string): Promise<Campaign | null> {
  const all = await listCampaigns(brand);
  return all.find((c) => c.id === id) ?? null;
}

export async function saveCampaigns(brand: CampaignBrand, campaigns: Campaign[]): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const { error } = await db
    .from("kv_store")
    .upsert(
      { key: key(brand), data: campaigns, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}

export async function upsertCampaign(brand: CampaignBrand, campaign: Campaign): Promise<void> {
  const all = await listCampaigns(brand);
  const idx = all.findIndex((c) => c.id === campaign.id);
  if (idx >= 0) all[idx] = campaign;
  else          all.push(campaign);
  await saveCampaigns(brand, all);
}

export async function deleteCampaign(brand: CampaignBrand, id: string): Promise<void> {
  const all = await listCampaigns(brand);
  await saveCampaigns(brand, all.filter((c) => c.id !== id));
}
