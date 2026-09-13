/**
 * 해리엇 마케팅 메일 수신거부 목록 + 원클릭 수신거부 링크.
 *
 * 2026-09-13 전까지 영문 마케팅 메일에는 "회신하면 빼드립니다" 문구만 있었다(9/10 설월 대기명단 발송).
 * 대기명단은 본인이 신청한 사람들이라 넘어갔지만, **신청하지 않은 과거 구매자**에게 보내는 메일은
 * 미국 CAN-SPAM · EU GDPR(기존고객 예외) · 영국 PECR 모두 쉬운 수신거부 수단을 요구한다.
 * 그래서 링크(GET) + RFC 8058 원클릭(POST, List-Unsubscribe 헤더) 둘 다 받는다.
 *
 * 저장: kv `harriot:email-optout:v1` = [{ email, at, campaign? }]. 발송 전 반드시 isOptedOut 로 거른다.
 * 링크 토큰은 이메일의 HMAC — 남의 주소를 링크만으로 수신거부시키는 장난을 막는다.
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

export const OPTOUT_KEY = "harriot:email-optout:v1";
/** 고객에게 보이는 도메인 — vercel.app 링크는 브랜드 메일에서 스팸처럼 보인다. 대시보드의 해리엇 별칭 도메인. */
export const HARRIOT_LINK_BASE = "https://today.harriotwatches.com";

export interface OptOut { email: string; at: string; campaign?: string | null }

function db() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("KV 미설정");
  return createClient(url, key, { auth: { persistSession: false } });
}
const norm = (e: string) => e.trim().toLowerCase();

export function optOutToken(email: string): string {
  const secret = process.env.APP_AUTH_SECRET;
  if (!secret) throw new Error("APP_AUTH_SECRET 없음");
  return createHmac("sha256", secret).update(norm(email)).digest("hex").slice(0, 24);
}

export function unsubscribeUrl(email: string, campaign?: string): string {
  const e = Buffer.from(norm(email), "utf8").toString("base64url");
  const q = new URLSearchParams({ e, t: optOutToken(email) });
  if (campaign) q.set("c", campaign);
  return `${HARRIOT_LINK_BASE}/api/harriot/unsubscribe?${q}`;
}

/** 링크 파라미터 검증 → 이메일. 토큰이 안 맞으면 null. */
export function verifyUnsubscribeParams(e: string | null, t: string | null): string | null {
  if (!e || !t) return null;
  let email = "";
  try { email = norm(Buffer.from(e, "base64url").toString("utf8")); } catch { return null; }
  if (!email.includes("@")) return null;
  return optOutToken(email) === t ? email : null;
}

export async function listOptOuts(): Promise<OptOut[]> {
  const { data } = await db().from("kv_store").select("data").eq("key", OPTOUT_KEY).maybeSingle();
  return (data?.data as OptOut[]) ?? [];
}

export async function isOptedOut(email: string, cache?: Set<string>): Promise<boolean> {
  const set = cache ?? new Set((await listOptOuts()).map((o) => o.email));
  return set.has(norm(email));
}

export async function addOptOut(email: string, campaign?: string | null): Promise<void> {
  const all = await listOptOuts();
  const e = norm(email);
  if (all.some((o) => o.email === e)) return;
  all.push({ email: e, at: new Date().toISOString(), campaign: campaign ?? null });
  await db().from("kv_store").upsert(
    { key: OPTOUT_KEY, data: all, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
