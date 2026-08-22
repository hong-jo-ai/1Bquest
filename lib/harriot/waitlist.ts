/**
 * 설월 출시 대기명단 — 인트로 페이지(눈 쓸기)에서 수집.
 *
 * 예약판매를 하지 않기로 하면서 런칭 당일 연락할 수 있는 명단이 0이 됐다.
 * 이 명단이 9/10 첫날 매출을 만드는 유일한 직접 채널이다.
 *
 * 수집 채널이 몰마다 다르다 (사장님 2026-08-22):
 *   국내(kr) = **전화번호** — 알림톡/SMS 도달률이 메일과 비교가 안 된다
 *   영문(en) = **이메일**   — 해외 문자는 국가번호·요금 문제로 실효가 없다
 *
 * ⚠️ 광고성 정보 수신은 개인정보 수집동의와 **별도**로 받는다(정보통신망법).
 *    SMS 발송 시 (광고) 표기 + 야간 21~08시 발송 금지.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type WaitlistMall = "kr" | "en";

export interface WaitlistEntry {
  mall: WaitlistMall;
  /** kr=정규화된 휴대폰(01012345678) · en=소문자 이메일 */
  contact: string;
  consentMarketing: boolean;
  /** 유입 경로 — 인스타 티저 회차별 기여를 보려면 이게 있어야 한다 */
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
  createdAt: string;
}

const KEY = "harriot:seolwol:waitlist:v1";

let sbCache: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (sbCache) return sbCache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다");
  sbCache = createClient(url, key, { auth: { persistSession: false } });
  return sbCache;
}

async function readAll(): Promise<WaitlistEntry[]> {
  const { data } = await sb().from("kv_store").select("data").eq("key", KEY).maybeSingle();
  return (data?.data as WaitlistEntry[]) ?? [];
}

async function writeAll(rows: WaitlistEntry[]): Promise<void> {
  await sb()
    .from("kv_store")
    .upsert({ key: KEY, data: rows, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/** 국내 휴대폰 정규화. 하이픈·공백·+82 를 걷어내고 010XXXXXXXX 형태만 통과시킨다. */
export function normalizePhone(raw: string): string | null {
  let s = raw.replace(/[\s()-]/g, "");
  if (s.startsWith("+82")) s = "0" + s.slice(3);
  else if (s.startsWith("82") && s.length >= 12) s = "0" + s.slice(2);
  return /^01[016789]\d{7,8}$/.test(s) ? s : null;
}

export function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  // 과하게 엄격하면 유효한 주소를 놓친다 — 형태만 본다.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

export type AddResult = { ok: true; duplicate: boolean } | { ok: false; reason: string };

export async function addWaitlistEntry(input: {
  mall: WaitlistMall;
  contact: string;
  consentPrivacy: boolean;
  consentMarketing: boolean;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
}): Promise<AddResult> {
  if (!input.consentPrivacy) return { ok: false, reason: "consent_required" };

  const contact =
    input.mall === "kr" ? normalizePhone(input.contact ?? "") : normalizeEmail(input.contact ?? "");
  if (!contact) return { ok: false, reason: "invalid_contact" };

  const rows = await readAll();
  // 같은 몰에 같은 연락처면 재등록하지 않는다. 다시 눌러도 성공으로 보이게 한다(마찰 최소화).
  if (rows.some((r) => r.mall === input.mall && r.contact === contact)) {
    return { ok: true, duplicate: true };
  }

  rows.push({
    mall: input.mall,
    contact,
    consentMarketing: !!input.consentMarketing,
    utmSource: input.utmSource ?? null,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    referrer: input.referrer ?? null,
    createdAt: new Date().toISOString(),
  });
  await writeAll(rows);
  return { ok: true, duplicate: false };
}

/** 관제용 요약 — 몰별·유입경로별. 티저 회차별 기여를 이걸로 본다. */
export async function waitlistSummary() {
  const rows = await readAll();
  const bySource: Record<string, number> = {};
  for (const r of rows) bySource[r.utmSource || "(direct)"] = (bySource[r.utmSource || "(direct)"] ?? 0) + 1;
  return {
    total: rows.length,
    kr: rows.filter((r) => r.mall === "kr").length,
    en: rows.filter((r) => r.mall === "en").length,
    marketingOptIn: rows.filter((r) => r.consentMarketing).length,
    bySource,
    rows,
  };
}
