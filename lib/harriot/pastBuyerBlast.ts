/**
 * 해리엇 과거 해외 구매자에게 설월 소식 메일 — CRM 캠페인 대상 테이블에서 읽어 보낸다.
 *
 * 대기명단 발송(waitlistBlast)과 다른 점:
 *   - 명단이 kv 가 아니라 **crm_campaign_targets** 다(캠페인 등록 → 홀드아웃 → 1인 1코드 → 발송 기록이 한 줄로).
 *   - 링크는 /c/<code> 개인 코드라 클릭이 잡힌다(대기명단 발송은 클릭 "—" 였다).
 *   - 수신거부 링크 + List-Unsubscribe 원클릭 헤더가 붙는다(신청하지 않은 사람들이라 필수).
 *   - 쿠폰 없음 — 1차는 소식만. 2주 뒤 미구매자에게 쿠폰 2차를 보내 할인 효과를 비교한다(사장님 결정 2026-09-13).
 *
 * 개인화: 이름(First) + 그 사람이 샀던 제품군. 제품은 kv `harriot:pastbuyer:profile:v1` { email: { products, last } } 에서.
 */
import { createClient } from "@supabase/supabase-js";
import { getCampaign, type CampaignTarget } from "@/lib/crm/campaign";
import { sendHarriotEmail } from "@/lib/harriot/emailSend";
import { HARRIOT_LINK_BASE, listOptOuts, unsubscribeUrl } from "@/lib/harriot/emailOptOut";

export const PROFILE_KEY = "harriot:pastbuyer:profile:v1";
export const EN_PRODUCT_URL = "https://harriotwatches.com/product/detail.html?product_no=136";

export interface BuyerProfile { products?: string[]; last?: string }

function db() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("KV 미설정");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** "Lisa,Sun" / "Lisa Sun" / "lisa" → "Lisa". 없으면 빈 문자열(인사말에서 이름을 뺀다). */
export function firstNameOf(name?: string | null): string {
  const first = String(name ?? "").replace(/,/g, " ").trim().split(/\s+/)[0] ?? "";
  if (!first || first.length < 2 || /[^a-z'\-]/i.test(first)) return "";
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

/** 구매 제품명 → 메일에서 부를 제품군. 밴드만 산 사람은 빈 문자열(→ "your Harriot"). */
export function familyOf(products?: string[]): string {
  const FAM: Array<[RegExp, string]> = [
    [/KARI/i, "KARI"], [/KI:?WON|KIWON/i, "KI:WON"], [/DOBO/i, "DOBO"],
    [/SEONGSAN/i, "SEONGSAN"], [/GAYANG/i, "GAYANG"], [/GWANGAN/i, "GWANGAN"],
  ];
  for (const p of products ?? []) for (const [re, f] of FAM) if (re.test(p)) return f;
  return "";
}

export interface MailCtx { firstName: string; family: string; clickUrl: string; unsubUrl: string }

export function buildSubject(): string {
  return "SEOLWOL — the moon that does not wane";
}

export function buildText(c: MailCtx): string {
  const hi = c.firstName ? `Hi ${c.firstName},` : "Hello,";
  const owned = c.family ? `you chose a ${c.family} from us` : "you chose a Harriot";
  return [
    hi,
    "",
    `Some time ago ${owned}. We wanted you to hear this from us before we say it anywhere louder:`,
    "our first moonphase is finished. It is called SEOLWOL (雪月, \"snow moon\").",
    "",
    "The moon does not wane. What changes is where it sits above the eaves.",
    "Every 29.5 days the moon in the dial completes one cycle — the same cycle Korean farmers and poets kept for centuries.",
    "",
    "38mm · Swiss Ronda moonphase · $350 · free engraving · worldwide shipping included",
    "",
    c.clickUrl,
    "",
    "Import duties and taxes are charged by your country and are not included.",
    "",
    "— Harriot, Seoul",
    "",
    "You are receiving this because you bought a Harriot at harriotwatches.com.",
    `Unsubscribe: ${c.unsubUrl}`,
  ].join("\n");
}

export function buildHtml(c: MailCtx): string {
  const img = "https://harriotwatches.com/seolwol/img/cut01-dial-hero.jpg";
  const hi = c.firstName ? `Hi ${c.firstName},` : "Hello,";
  const owned = c.family ? `you chose a ${c.family} from us` : "you chose a Harriot";
  const F = "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;";
  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 16px 40px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%;">

<tr><td style="${F}font-size:15px;line-height:1.7;color:#3c444f;padding-bottom:18px;">
  ${hi}<br><br>
  Some time ago ${owned}. We wanted you to hear this from us before we say it anywhere louder:
  our first moonphase is finished. It is called <b>SEOLWOL</b> (雪月, &ldquo;snow moon&rdquo;).
</td></tr>

<tr><td style="padding-bottom:26px;">
  <a href="${c.clickUrl}" style="text-decoration:none;">
    <img src="${img}" width="520" alt="SEOLWOL — a full moon resting above a hanok eave, seen through the dial window"
         style="display:block;width:100%;max-width:520px;height:auto;border:0;outline:none;text-decoration:none;">
  </a>
</td></tr>

<tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.45;color:#14181f;padding-bottom:14px;">
  The moon does not wane.<br>What changes is where it sits above the eaves.
</td></tr>

<tr><td style="${F}font-size:15px;line-height:1.7;color:#3c444f;padding-bottom:20px;">
  Every 29.5 days the moon in the dial completes one cycle &mdash; the same cycle Korean farmers and poets kept for centuries.
</td></tr>

<tr><td style="${F}font-size:14px;line-height:1.7;color:#6b7280;padding-bottom:26px;">
  38mm &middot; Swiss Ronda moonphase &middot; $350 &middot; free engraving &middot; worldwide shipping included
</td></tr>

<tr><td style="padding-bottom:26px;">
  <a href="${c.clickUrl}" style="display:inline-block;${F}font-size:13px;letter-spacing:.09em;text-transform:uppercase;
     color:#14181f;text-decoration:none;border:1px solid #14181f;padding:13px 26px;">See SEOLWOL</a>
</td></tr>

<tr><td style="${F}font-size:12.5px;line-height:1.7;color:#8a919c;border-top:1px solid #e6e8ec;padding-top:18px;">
  Import duties and taxes are charged by your country and are not included.<br><br>
  &mdash; Harriot, Seoul<br><br>
  You are receiving this because you bought a Harriot at harriotwatches.com.
  <a href="${c.unsubUrl}" style="color:#8a919c;">Unsubscribe</a>
</td></tr>

</table></td></tr></table>
</body></html>`;
}

export interface PastBuyerBlastInput {
  campaign: string;
  /** 실발송은 `SEND:<campaign>` 과 정확히 일치할 때만 */
  confirm?: string;
  /** 이 주소로 샘플 1통만(DB 기록 없음) */
  testOnly?: { email: string; name?: string; products?: string[] };
  /** 한 번에 보낼 최대 통수(Vercel 실행시간 안에서). 남으면 다시 호출한다. */
  limit?: number;
}

export interface PastBuyerBlastResult {
  dryRun: boolean; campaign: string;
  pending: number; optedOut: number; attempted: number; success: number; failed: number; remaining: number;
  preview?: { to: string; subject: string; text: string };
  blocked?: string;
}

export async function runPastBuyerBlast(input: PastBuyerBlastInput): Promise<PastBuyerBlastResult> {
  const campaign = await getCampaign(input.campaign);
  if (!campaign) return { dryRun: true, campaign: input.campaign, pending: 0, optedOut: 0, attempted: 0, success: 0, failed: 0, remaining: 0, blocked: "campaign_not_found" };
  const subject = buildSubject();
  const real = input.confirm === `SEND:${input.campaign}`;

  const ctxOf = (t: { code: string; name?: string | null; email: string }, profile?: BuyerProfile): MailCtx => ({
    firstName: firstNameOf(t.name),
    family: familyOf(profile?.products),
    clickUrl: `${HARRIOT_LINK_BASE}/c/${t.code}`,
    unsubUrl: unsubscribeUrl(t.email, input.campaign),
  });
  const headersOf = (c: MailCtx) => ({
    "List-Unsubscribe": `<${c.unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });

  // 테스트 1통 — 코드는 "test" 라 클릭 링크는 홈으로 떨어진다. 문안·렌더 확인용.
  if (input.testOnly?.email) {
    const c = ctxOf({ code: "test", name: input.testOnly.name ?? "Test", email: input.testOnly.email }, { products: input.testOnly.products ?? ["KI:WON Baeksaek(White)"] });
    const base = { dryRun: !real, campaign: input.campaign, pending: 0, optedOut: 0, attempted: 0, success: 0, failed: 0, remaining: 0, preview: { to: input.testOnly.email, subject, text: buildText(c) } };
    if (!real) return base;
    const r = await sendHarriotEmail({ to: input.testOnly.email, subject, text: buildText(c), html: buildHtml(c), headers: headersOf(c) });
    return { ...base, attempted: 1, success: r.ok ? 1 : 0, failed: r.ok ? 0 : 1, blocked: r.ok ? undefined : `send_failed:${r.status} ${r.error ?? ""}` };
  }

  const sb = db();
  const { data: rows } = await sb.from("crm_campaign_targets")
    .select("id, code, name, email, holdout, sent_at")
    .eq("campaign_id", input.campaign).eq("holdout", false).is("sent_at", null).eq("channel", "email")
    .order("id", { ascending: true });
  const pending = (rows ?? []) as Array<CampaignTarget & { id: string; email: string }>;
  const optSet = new Set((await listOptOuts()).map((o) => o.email));
  const { data: prof } = await sb.from("kv_store").select("data").eq("key", PROFILE_KEY).maybeSingle();
  const profiles = (prof?.data as Record<string, BuyerProfile>) ?? {};

  const sendable = pending.filter((t) => t.email && !optSet.has(t.email.toLowerCase()));
  const optedOut = pending.length - sendable.length;
  const batch = sendable.slice(0, Math.max(1, Math.min(input.limit ?? 80, 200)));
  const first = batch[0];
  const preview = first ? { to: first.email, subject, text: buildText(ctxOf(first, profiles[first.email.toLowerCase()])) } : undefined;
  const base: PastBuyerBlastResult = { dryRun: !real, campaign: input.campaign, pending: pending.length, optedOut, attempted: 0, success: 0, failed: 0, remaining: sendable.length, preview };
  if (!real) return base;

  // 수신거부자는 발송 안 함으로 표시해 다음 호출에서 다시 안 뜨게
  for (const t of pending) if (t.email && optSet.has(t.email.toLowerCase())) {
    await sb.from("crm_campaign_targets").update({ sent_at: new Date().toISOString(), send_status: "optout" }).eq("id", t.id);
  }

  let success = 0, failed = 0;
  for (const t of batch) {
    const c = ctxOf(t, profiles[t.email.toLowerCase()]);
    let r: { ok: boolean; status: number; error?: string };
    try { r = await sendHarriotEmail({ to: t.email, subject, text: buildText(c), html: buildHtml(c), headers: headersOf(c) }); }
    catch (e) { r = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }; }
    await sb.from("crm_campaign_targets").update({
      sent_at: new Date().toISOString(), send_status: r.ok ? "ok" : `fail:${r.status}`,
    }).eq("id", t.id);
    if (r.ok) success++; else failed++;
    await new Promise((res) => setTimeout(res, 120)); // Gmail API 초당 제한 여유
  }
  return { ...base, dryRun: false, attempted: batch.length, success, failed, remaining: sendable.length - batch.length };
}
