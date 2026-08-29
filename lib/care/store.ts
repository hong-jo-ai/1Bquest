/**
 * PAULVICE CARE — 구매자 케어 등록 저장소.
 *
 * 목적: 마켓(무신사·W컨셉·29CM·공구·카카오) 구매자는 배송 목적으로 받은 정보라 광고 발송이
 * 불가하다. 상품에 동봉한 카드 → QR → 여기서 **본인이 직접 남긴 동의**만이 그들에게
 * 합법적으로 연락할 수 있는 유일한 경로다. 기획 문서: docs/paulvice-care.md
 *
 * 설계 원칙 — 30초 안에 끝나야 한다.
 *   · 시리얼·주문번호·구매처를 묻지 않는다(증빙을 찾게 만들면 거기서 이탈).
 *   · 본인확인은 SMS OTP. PASS/NICE 는 계약·건당 비용이 크고 주민번호까지 받게 된다.
 *   · 동의는 **필수(케어 제공) / 선택(광고 수신)** 을 분리해 받는다. 섞으면 동의가 무효다.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const OTP_TTL_SEC = 180;      // 3분 — 문자 도착 후 입력까지 충분하고, 재사용 위험은 짧게
const OTP_MAX_TRY = 5;

export interface CareRegistration {
  id?: string;
  phone: string;
  product_no?: number | null;
  product_name?: string | null;
  product_other?: string | null;
  ad_consent: boolean;
  consent_at?: string | null;
  source?: string | null;
  coupon_code?: string | null;
  battery_used_at?: string | null;
  registered_at?: string;
}

function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
export const isMobile = (p: string) => /^01[016789]\d{7,8}$/.test(p);

const otpKey = (phone: string) => `care:otp:${phone}`;

/** 인증번호 발급 — 같은 번호로 연속 요청 시 기존 코드를 덮어쓴다(문자 폭탄 방지는 라우트에서). */
export async function issueOtp(phone: string): Promise<string> {
  const sb = db(); if (!sb) throw new Error("KV 미설정");
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await sb.from("kv_store").upsert({
    key: otpKey(phone),
    data: { code, exp: Date.now() + OTP_TTL_SEC * 1000, tries: 0 },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  return code;
}

export async function verifyOtp(phone: string, code: string): Promise<{ ok: boolean; reason?: string }> {
  const sb = db(); if (!sb) return { ok: false, reason: "서버 오류" };
  const { data } = await sb.from("kv_store").select("data").eq("key", otpKey(phone)).maybeSingle();
  const rec = data?.data as { code: string; exp: number; tries: number } | undefined;
  if (!rec) return { ok: false, reason: "인증번호를 다시 요청해 주세요" };
  if (Date.now() > rec.exp) return { ok: false, reason: "인증번호가 만료되었습니다" };
  if (rec.tries >= OTP_MAX_TRY) return { ok: false, reason: "시도 횟수를 초과했습니다" };
  if (rec.code !== digits(code)) {
    await sb.from("kv_store").upsert({
      key: otpKey(phone), data: { ...rec, tries: rec.tries + 1 }, updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    return { ok: false, reason: "인증번호가 맞지 않습니다" };
  }
  await sb.from("kv_store").delete().eq("key", otpKey(phone));   // 1회용
  return { ok: true };
}

const SESS_TTL_SEC = 600;   // 10분 — 인증 후 제품 선택·동의까지 넉넉히
const sessKey = (t: string) => `care:sess:${t}`;

/**
 * 본인확인 통과 증표. 인증번호는 1회용이라 검증 단계에서 사라지므로,
 * 등록 API 가 다시 확인할 수 있게 짧은 세션 토큰을 발급한다.
 * (이게 없으면 등록에서 "인증번호를 다시 요청해 주세요"가 뜬다 — 2026-08-29 실제로 발생)
 */
export async function issueSession(phone: string): Promise<string> {
  const sb = db(); if (!sb) throw new Error("KV 미설정");
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  await sb.from("kv_store").upsert({
    key: sessKey(token), data: { phone, exp: Date.now() + SESS_TTL_SEC * 1000 },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  return token;
}

/** 등록 시 1회 소모. 같은 토큰으로 두 번 등록되지 않는다. */
export async function consumeSession(phone: string, token: string): Promise<boolean> {
  const sb = db(); if (!sb || !token) return false;
  const { data } = await sb.from("kv_store").select("data").eq("key", sessKey(token)).maybeSingle();
  const rec = data?.data as { phone: string; exp: number } | undefined;
  if (!rec || rec.phone !== phone || Date.now() > rec.exp) return false;
  await sb.from("kv_store").delete().eq("key", sessKey(token));
  return true;
}

/** 등록 — 같은 번호·같은 제품이면 덮어쓴다(중복 탭/재등록 대응) */
export async function register(r: CareRegistration): Promise<CareRegistration | null> {
  const sb = db(); if (!sb) return null;
  const row = {
    phone: r.phone,
    product_no: r.product_no ?? null,
    product_name: r.product_name ?? null,
    product_other: r.product_other ?? null,
    ad_consent: !!r.ad_consent,
    consent_at: r.ad_consent ? new Date().toISOString() : null,
    source: r.source ?? null,
    coupon_code: r.coupon_code ?? null,
  };
  const { data, error } = await sb.from("care_registrations")
    .upsert(row, { onConflict: "phone,product_no" }).select().maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CareRegistration) ?? null;
}

/**
 * 스트랩 쿠폰 시리얼 배정 — 미배정 코드 하나를 집어 이 번호에 묶는다.
 * 같은 번호가 다시 등록하면 **이미 받은 코드를 그대로 돌려준다**(중복 소진 방지).
 * 풀이 비면 null — 등록 자체는 계속 진행하고 쿠폰만 나중에 안내한다.
 * 쿠폰이 없다고 등록을 실패시키면 우리가 진짜 원하는 것(동의받은 연락처)을 잃는다.
 */
/**
 * 이 번호가 **어느 채널에서 샀는지** 발송기록으로 역추적한다.
 *
 * 카드는 전 주문에 동봉하므로 QR 파라미터만으로는 자사몰/마켓 구분이 안 된다.
 * 그런데 발송기록(pp_shipments)에 수취인 연락처가 이미 있어서, 등록 시점에 대조하면
 * 운영 부담 없이 채널이 붙는다 → "카드가 마켓 고객을 실제로 몇 명 데려왔나"를 잴 수 있다.
 * 여러 채널에서 산 사람은 가장 최근 구매 채널을 채택한다.
 */
export async function detectChannel(phone: string): Promise<string | null> {
  const sb = db(); if (!sb) return null;
  const { data } = await sb.from("pp_shipments")
    .select("channel,created_at")
    .eq("recipient_mobile", digits(phone))
    .eq("req_type", "1").eq("is_test", false)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { channel?: string } | null)?.channel ?? null;
}

export async function assignSerial(phone: string): Promise<string | null> {
  const sb = db(); if (!sb) return null;
  const mine = await sb.from("care_coupon_serials").select("code").eq("assigned_to", phone).limit(1).maybeSingle();
  if (mine.data?.code) return mine.data.code as string;

  // 경합 방지: 미배정 후보를 넉넉히 뽑아 하나씩 조건부 UPDATE(assigned_at IS NULL) 로 선점한다.
  const { data: pool } = await sb.from("care_coupon_serials")
    .select("code").is("assigned_at", null).limit(20);
  for (const row of (pool ?? []) as Array<{ code: string }>) {
    const { data } = await sb.from("care_coupon_serials")
      .update({ assigned_to: phone, assigned_at: new Date().toISOString() })
      .eq("code", row.code).is("assigned_at", null).select().maybeSingle();
    if (data) return row.code;
  }
  return null;
}

/** 남은 시리얼 수 — 소진 경보용 */
export async function serialsLeft(): Promise<number> {
  const sb = db(); if (!sb) return 0;
  const { count } = await sb.from("care_coupon_serials")
    .select("*", { count: "exact", head: true }).is("assigned_at", null);
  return count ?? 0;
}

export async function listByPhone(phone: string): Promise<CareRegistration[]> {
  const sb = db(); if (!sb) return [];
  const { data } = await sb.from("care_registrations").select("*").eq("phone", digits(phone));
  return (data as CareRegistration[]) ?? [];
}

export interface CareStats { total: number; adConsent: number; consentRate: number; batteryUsed: number; last7d: number }

export async function stats(): Promise<CareStats> {
  const sb = db();
  const empty: CareStats = { total: 0, adConsent: 0, consentRate: 0, batteryUsed: 0, last7d: 0 };
  if (!sb) return empty;
  const { data } = await sb.from("care_registrations").select("ad_consent,battery_used_at,registered_at");
  const rows = (data as Array<{ ad_consent: boolean; battery_used_at: string | null; registered_at: string }>) ?? [];
  const wk = Date.now() - 7 * 86400000;
  const adConsent = rows.filter((r) => r.ad_consent).length;
  return {
    total: rows.length,
    adConsent,
    consentRate: rows.length ? adConsent / rows.length : 0,
    batteryUsed: rows.filter((r) => r.battery_used_at).length,
    last7d: rows.filter((r) => new Date(r.registered_at).getTime() > wk).length,
  };
}
