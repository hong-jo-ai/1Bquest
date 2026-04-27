import { createClient } from "@supabase/supabase-js";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export interface SeasonModifier {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  roasThresholdModifier: number;
  isActive: boolean;
  notes: string | null;
}

function kstToday(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** 오늘(KST) 기준 활성 시즌 가중치 합산 (여러 시즌이 겹치면 모두 더함). */
export async function getActiveSeasonModifier(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const today = kstToday();
  const { data } = await db
    .from("mads_season_modifiers")
    .select("roas_threshold_modifier")
    .eq("is_active", true)
    .lte("start_date", today)
    .gte("end_date", today);
  if (!data) return 0;
  return data.reduce((sum, r) => sum + Number(r.roas_threshold_modifier ?? 0), 0);
}

export async function listSeasonModifiers(): Promise<SeasonModifier[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from("mads_season_modifiers")
    .select("*")
    .order("start_date", { ascending: false });
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    roasThresholdModifier: Number(r.roas_threshold_modifier),
    isActive: r.is_active,
    notes: r.notes,
  }));
}
