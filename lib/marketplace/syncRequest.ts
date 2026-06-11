/**
 * 텔레그램 on-demand 동기화 트리거.
 *
 * 사장님이 봇에 "W컨셉 동기화" / "무신사 동기화" 보내면 webhook이 여기에 요청을 기록하고,
 * 아이맥의 triggerWatcher.js가 /api/marketplace/sync-request 를 폴링하다 새 요청을 보면
 * 해당 채널 동기화 스크립트를 실행한다. (배포 서버는 아이맥 로컬 에이전트에 직접 못 닿으므로
 * 아이맥이 폴링하는 구조)
 */
import { createClient } from "@supabase/supabase-js";

const KV_KEY = "marketplace_sync_request";

export interface SyncRequest {
  channel: string;
  ts: string; // ISO
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function storeSyncRequest(channel: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const entry: SyncRequest = { channel, ts: new Date().toISOString() };
  const { error } = await db
    .from("kv_store")
    .upsert({ key: KV_KEY, data: entry, updated_at: entry.ts }, { onConflict: "key" });
  if (error) throw error;
}

export async function getSyncRequest(): Promise<SyncRequest | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db.from("kv_store").select("data").eq("key", KV_KEY).maybeSingle();
  const e = (data as { data?: SyncRequest } | null)?.data;
  return e && e.channel ? e : null;
}

/** 텔레그램 메시지가 동기화 명령이면 채널명 반환, 아니면 null. */
export function parseSyncCommand(text: string): string | null {
  // 면세점 발주 처리 — 발주제안서→입고서류 생성·저장 + 면세점 박스 차감 (dutyFreeProcess)
  if (/면세점.*(발주|입고|패킹|출고|처리)|(발주|입고|패킹).*면세점/i.test(text)) return "dutyfree";
  // W컨셉 광고비 집계 (Moloco RMP 2계정 합산 → ad_spend:wconcept)
  if (/광고비|광고\s*집계|광고\s*동기화/i.test(text)) return "wconcept_ads";
  if (!/동기화|sync|가져오기|업로드/i.test(text)) return null;
  if (/w.?컨셉|wconcept|더블유/i.test(text)) return "wconcept";
  if (/무신사|musinsa/i.test(text)) return "musinsa";
  if (/29\s?cm|29씨엠|이십구씨엠|투에니/i.test(text)) return "29cm";
  if (/식스샵|식스|sixshop|6shop/i.test(text)) return "sixshop"; // 국내+글로벌 둘 다 (runSixshopSync)
  return null;
}
