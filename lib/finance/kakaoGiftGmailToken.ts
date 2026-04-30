/**
 * 카카오선물하기 발주서 전용 Gmail 토큰 (plvekorea@gmail.com).
 * 캘린더/인박스 분류용 shong@harriotwatches.com 토큰과 분리.
 *
 * KV key: kakao_gift_gmail_token (refresh_token 단일 string 저장)
 */
import { createClient } from "@supabase/supabase-js";
import { refreshGoogleToken } from "@/lib/ga4Client";

const KV_KEY = "kakao_gift_gmail_token";

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function saveKakaoGiftGmailRefreshToken(refreshToken: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { error } = await db
    .from("kv_store")
    .upsert(
      { key: KV_KEY, data: refreshToken, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
}

export async function getKakaoGiftGmailAccessToken(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", KV_KEY)
    .maybeSingle();
  if (!data?.data) return null;
  const refreshToken = data.data as string;
  try {
    return await refreshGoogleToken(refreshToken);
  } catch (e) {
    console.error("[kakao-gift-gmail] refresh 실패:", e);
    return null;
  }
}

export async function hasKakaoGiftGmailToken(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", KV_KEY)
    .maybeSingle();
  return !!data?.data;
}
