/**
 * W컨셉 등 SMS 2차 인증 코드 릴레이.
 *
 * 사장님이 휴대폰 SMS로 받은 인증번호를 텔레그램 봇에 "wc 123456" 형태로 보내면
 * webhook 이 여기 저장(storeSmsCode)하고, 로컬 에이전트가 /api/marketplace/sms-code
 * 로 가져간다(getSmsCode). kv_store 단일 키에 최신 1건만 보관.
 */
import { createClient } from "@supabase/supabase-js";

const KV_KEY = "marketplace_sms_code";

export interface SmsCodeEntry {
  code: string;
  ts: string; // ISO — 저장 시각
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 텔레그램으로 받은 SMS 코드를 저장 (최신 1건 교체). */
export async function storeSmsCode(code: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Supabase 미설정");
  const entry: SmsCodeEntry = { code, ts: new Date().toISOString() };
  const { error } = await db
    .from("kv_store")
    .upsert({ key: KV_KEY, data: entry, updated_at: entry.ts }, { onConflict: "key" });
  if (error) throw error;
}

/** 저장된 최신 SMS 코드 조회. */
export async function getSmsCode(): Promise<SmsCodeEntry | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db.from("kv_store").select("data").eq("key", KV_KEY).maybeSingle();
  const entry = (data as { data?: SmsCodeEntry } | null)?.data;
  return entry && entry.code ? entry : null;
}

/** 텍스트가 W컨셉 코드 릴레이("wc 123456")면 코드 숫자를 반환, 아니면 null. */
export function parseWcCodeMessage(text: string): string | null {
  const m = text.match(/^\s*wc[\s:]*([0-9]{4,8})\s*$/i);
  return m ? m[1] : null;
}
