/**
 * 설월 출시 알림 발송 — 대기명단(kr=문자 · en=이메일) 일괄 발송.
 *
 * 이 파일의 유일한 목적은 "런칭 당일 한 번" 쏘는 것이다. 그래서 설계 원칙이 보수적이다:
 *
 *  1. **기본은 dry-run.** confirm 토큰이 정확히 일치할 때만 실제로 나간다.
 *     날짜 기반 자동 발송은 하지 않는다 — 런칭이 밀리거나 당겨질 수 있고(사장님 2026-08-22),
 *     날짜에 걸어두면 연기된 날 아침에 명단 전체로 오발송이 난다. 사람이 최종 확인한다.
 *  2. **한 번 보낸 캠페인은 다시 못 보낸다.** 발송 기록을 남기고, 이미 보낸 캠페인 키로
 *     다시 호출하면 거부한다(중복 발송 = 스팸 신고 + 브랜드 신뢰 손상).
 *  3. **야간 발송 차단.** 정보통신망법상 광고성 문자는 21~08시 발송 금지.
 *     evenIfNight 로 끌 수 있지만 기본은 막는다.
 *  4. 문자 본문에는 **(광고)** 표기와 무료수신거부 안내가 반드시 들어간다.
 */
import { sendMany } from "@/lib/sms/solapi";
import { listGmailAccounts, getGmailAccessToken } from "@/lib/cs/gmailClient";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const LOG_KEY = "harriot:seolwol:blast-log:v1";

export interface BlastLogEntry {
  campaign: string;
  sentAt: string;
  krAttempted: number;
  krSuccess: number;
  enAttempted: number;
  enSuccess: number;
}

let sbCache: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (sbCache) return sbCache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다");
  sbCache = createClient(url, key, { auth: { persistSession: false } });
  return sbCache;
}

export async function readBlastLog(): Promise<BlastLogEntry[]> {
  const { data } = await sb().from("kv_store").select("data").eq("key", LOG_KEY).maybeSingle();
  return (data?.data as BlastLogEntry[]) ?? [];
}

async function appendBlastLog(entry: BlastLogEntry): Promise<void> {
  const rows = await readBlastLog();
  rows.push(entry);
  await sb()
    .from("kv_store")
    .upsert({ key: LOG_KEY, data: rows, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

/** 한국시간 기준 시(hour). 야간 발송 차단 판정용. */
function seoulHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );
}

/** 국내 문자 본문 — (광고) 표기·수신거부 안내는 법적 필수라 호출자가 못 빼게 여기서 붙인다. */
export function buildKrText(landingUrl: string): string {
  return [
    "(광고) 해리엇",
    "",
    "기다려주신 설월 雪月, 오늘 공개되었습니다.",
    "달이 차고 기울지 않습니다. 처마 위 어디에 걸렸는가가 바뀝니다.",
    "38mm · 349,000원 · 각인 무료",
    "",
    landingUrl,
    "",
    "무료수신거부 080-828-1391",
  ].join("\n");
}

export function buildEnSubject(): string {
  return "SEOLWOL — the moon that does not wane";
}

export function buildEnBody(landingUrl: string): string {
  return [
    "You asked us to tell you when SEOLWOL arrived. It is here.",
    "",
    "The moon does not wane. What changes is where it sits above the eaves.",
    "38mm · $350 · free engraving",
    "",
    landingUrl,
    "",
    "— Harriot",
    "",
    "You are receiving this because you joined the SEOLWOL launch list at harriotwatches.com.",
    "Reply to this email if you would like to be removed.",
  ].join("\n");
}

async function sendOneEmail(to: string, subject: string, body: string): Promise<boolean> {
  const accounts = await listGmailAccounts();
  const account = accounts[0];
  if (!account) throw new Error("Gmail 계정이 연결되어 있지 않습니다");
  const accessToken = await getGmailAccessToken(account);

  const rfc822 =
    [
      `To: ${to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`,
      `Content-Type: text/plain; charset="UTF-8"`,
      "MIME-Version: 1.0",
    ].join("\r\n") +
    "\r\n\r\n" +
    body;

  const raw = Buffer.from(rfc822, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  return res.ok;
}

export interface BlastInput {
  /** 캠페인 키. 같은 키로 두 번 보낼 수 없다. 예: "seolwol-launch" */
  campaign: string;
  /** 실제 발송하려면 `SEND:${campaign}` 과 정확히 일치해야 한다. 없으면 dry-run. */
  confirm?: string;
  /** 이 번호/주소로만 보낸다(테스트용). 지정하면 명단 전체가 아니라 이것만. */
  testOnly?: { phone?: string; email?: string };
  landingUrl?: string;
  /** 21~08시 발송 차단 해제 (기본 false) */
  evenIfNight?: boolean;
}

export interface BlastResult {
  dryRun: boolean;
  campaign: string;
  krCount: number;
  enCount: number;
  krSuccess?: number;
  enSuccess?: number;
  krPreview: string;
  enPreview: { subject: string; body: string };
  blocked?: string;
}

export async function runBlast(
  input: BlastInput,
  waitlist: { mall: string; contact: string }[],
): Promise<BlastResult> {
  const landing = input.landingUrl ?? "https://harriotwatches.co.kr/product/detail.html?product_no=136";
  const krText = buildKrText(landing);
  const enSubject = buildEnSubject();
  const enBody = buildEnBody(input.landingUrl ?? "https://harriotwatches.com/product/detail.html?product_no=136");

  const test = input.testOnly;
  const krList = test
    ? test.phone
      ? [test.phone]
      : []
    : waitlist.filter((r) => r.mall === "kr").map((r) => r.contact);
  const enList = test
    ? test.email
      ? [test.email]
      : []
    : waitlist.filter((r) => r.mall === "en").map((r) => r.contact);

  const base: BlastResult = {
    dryRun: true,
    campaign: input.campaign,
    krCount: krList.length,
    enCount: enList.length,
    krPreview: krText,
    enPreview: { subject: enSubject, body: enBody },
  };

  // 확인 토큰이 없으면 여기서 끝 — 미리보기만 돌려준다.
  if (input.confirm !== `SEND:${input.campaign}`) return base;

  // 실발송 경로. 아래 가드는 순서가 중요하다(중복 → 야간).
  if (!test) {
    const log = await readBlastLog();
    if (log.some((l) => l.campaign === input.campaign)) {
      return { ...base, blocked: "already_sent" };
    }
  }
  const hour = seoulHour();
  if (!input.evenIfNight && (hour >= 21 || hour < 8)) {
    return { ...base, blocked: "night_hours" };
  }

  let krSuccess = 0;
  if (krList.length) {
    const outcome = await sendMany(krList.map((to) => ({ to, text: krText })));
    krSuccess = outcome.successCount;
  }

  let enSuccess = 0;
  for (const to of enList) {
    try {
      if (await sendOneEmail(to, enSubject, enBody)) enSuccess++;
    } catch {
      /* 한 건 실패가 전체를 멈추면 안 된다 */
    }
  }

  if (!test) {
    await appendBlastLog({
      campaign: input.campaign,
      sentAt: new Date().toISOString(),
      krAttempted: krList.length,
      krSuccess,
      enAttempted: enList.length,
      enSuccess,
    });
  }

  return { ...base, dryRun: false, krSuccess, enSuccess };
}
