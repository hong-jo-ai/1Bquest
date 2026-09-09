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
    "38mm · $350 · free engraving · worldwide shipping included",
    "",
    landingUrl,
    "",
    // 관세 별도는 반드시 남긴다 — DDU 라 도착 후 관세 클레임이 나는 지점이다(2026-09-09).
    "Import duties and taxes are charged by your country and are not included.",
    "",
    "— Harriot",
    "",
    "You are receiving this because you joined the SEOLWOL launch list at harriotwatches.com.",
    "Reply to this email if you would like to be removed.",
  ].join("\n");
}

/**
 * HTML 본문 — 사진 한 장 + 같은 카피.
 *
 * 메일 클라이언트는 원격 이미지를 기본 차단하는 곳이 많고, 텍스트만 읽는 클라이언트도 있다.
 * 그래서 이 HTML 은 **덤**이다 — multipart/alternative 의 다른 쪽에 buildEnBody() 의
 * 평문이 그대로 들어가고, 이미지가 안 떠도 alt 와 카피만으로 읽힌다.
 * 웹폰트는 쓰지 않는다(대부분의 메일 클라이언트가 무시한다).
 */
export function buildEnHtml(landingUrl: string): string {
  const img = "https://harriotwatches.com/seolwol/img/cut01-dial-hero.jpg";
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 16px 40px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%;">

<tr><td style="padding-bottom:26px;">
  <a href="${landingUrl}" style="text-decoration:none;">
    <img src="${img}" width="520" alt="SEOLWOL — a full moon resting above a hanok eave, seen through the dial window"
         style="display:block;width:100%;max-width:520px;height:auto;border:0;outline:none;text-decoration:none;">
  </a>
</td></tr>

<tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.45;color:#14181f;padding-bottom:14px;">
  The moon does not wane.<br>What changes is where it sits above the eaves.
</td></tr>

<tr><td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#3c444f;padding-bottom:20px;">
  You asked us to tell you when SEOLWOL arrived. It is here.
</td></tr>

<tr><td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:#6b7280;padding-bottom:26px;">
  38mm &middot; $350 &middot; free engraving &middot; worldwide shipping included
</td></tr>

<tr><td style="padding-bottom:26px;">
  <a href="${landingUrl}" style="display:inline-block;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;
     font-size:13px;letter-spacing:.09em;text-transform:uppercase;color:#14181f;text-decoration:none;
     border:1px solid #14181f;padding:13px 26px;">See SEOLWOL</a>
</td></tr>

<tr><td style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.7;color:#8a919c;
    border-top:1px solid #e6e8ec;padding-top:18px;">
  Import duties and taxes are charged by your country and are not included.<br><br>
  &mdash; Harriot<br><br>
  You are receiving this because you joined the SEOLWOL launch list at harriotwatches.com.
  Reply to this email if you would like to be removed.
</td></tr>

</table></td></tr></table>
</body></html>`;
}

/**
 * 발신 계정 — 반드시 해리엇 주소로 나가야 한다.
 *
 * 2026-09-09 사고 직전에 잡았다: 예전 코드는 `accounts[0]` 을 썼는데 그 목록에 ORDER BY 가 없다.
 * 실제로 첫 테스트가 **폴바이스 계정(plvekorea@gmail.com)** 으로 나갔다. harriotwatches.com 에서
 * 신청한 사람에게 다른 브랜드 주소로 가면 피싱으로 읽히고, 순서가 보장되지 않으니 매번 달라질 수도 있다.
 *
 * gmail.com 주소를 쓰는 이유: harriotwatches.com 은 SPF 만 있고 **DKIM·DMARC 가 없다**(2026-09-09 확인).
 * 한 번에 100통 넘게 보내는 발송이라 인증이 완비된 주소가 안전하다. DKIM/DMARC 를 붙인 뒤에
 * 아래 주소만 shong@harriotwatches.com 으로 바꾸면 된다.
 */
const SENDER_EMAIL = "harriotwatches@gmail.com";
const SENDER_NAME = "Harriot";

async function sendOneEmail(to: string, subject: string, body: string, html?: string): Promise<boolean> {
  const accounts = await listGmailAccounts();
  const account = accounts.find((a) => a.brand === "harriot" && a.displayName === SENDER_EMAIL);
  if (!account) {
    // 다른 브랜드 계정으로 대신 보내느니 실패하는 게 낫다.
    throw new Error(
      `발신 계정 ${SENDER_EMAIL} 이 연결되어 있지 않습니다 (연결된 계정: ${accounts.map((a) => `${a.brand}/${a.displayName}`).join(", ") || "없음"})`,
    );
  }
  const accessToken = await getGmailAccessToken(account);

  // 본문은 파트마다 base64 로 싣는다. 줄바꿈 길이·비ASCII(雪月, &middot;, &mdash;) 문제를 원천 차단한다.
  const b64 = (t: string) => Buffer.from(t, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");

  const head = [
    `From: =?UTF-8?B?${Buffer.from(SENDER_NAME, "utf-8").toString("base64")}?= <${SENDER_EMAIL}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`,
    "MIME-Version: 1.0",
  ];

  let rfc822: string;
  if (html) {
    // multipart/alternative — 평문이 먼저, HTML 이 나중. 클라이언트가 읽을 수 있는 쪽을 고른다.
    // 이미지가 차단돼도, HTML 을 못 읽어도 평문이 남는다.
    const bd = `hrt_${Date.now().toString(36)}`;
    rfc822 =
      [...head, `Content-Type: multipart/alternative; boundary="${bd}"`].join("\r\n") +
      "\r\n\r\n" +
      [
        `--${bd}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        b64(body),
        `--${bd}`,
        'Content-Type: text/html; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        b64(html),
        `--${bd}--`,
        "",
      ].join("\r\n");
  } else {
    rfc822 =
      [...head, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"].join("\r\n") +
      "\r\n\r\n" +
      b64(body);
  }

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
  const enHtml = buildEnHtml(input.landingUrl ?? "https://harriotwatches.com/product/detail.html?product_no=136");

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
      if (await sendOneEmail(to, enSubject, enBody, enHtml)) enSuccess++;
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
