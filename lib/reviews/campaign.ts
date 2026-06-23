/**
 * 리뷰 요청 캠페인 — 과거 구매자 일괄 + (추후)구매후 자동.
 * 이메일은 배포된 앱(Vercel)에서 기존 Gmail 인프라(lib/cs/gmailClient)로 발송.
 */
import { signReviewToken, getMall, type MallId } from "./core";
import { listGmailAccounts, getGmailAccessToken } from "@/lib/cs/gmailClient";
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";

// 발송 발신자 — 창업자 개인 워크스페이스(이미 연결된 shong@ 토큰 = google_refresh_token).
const FOUNDER_FROM = process.env.REVIEW_FROM || "Sungjo · Harriot <shong@harriotwatches.com>";

const GOLD = "#c9a96a", DARK = "#1a1a1a";
const BASE = () => process.env.REVIEW_BASE_URL || "https://paulvice-dashboard.vercel.app";

export interface Target {
  id: string; mall: MallId; email: string; customer_name: string | null;
  product_no: number | null; product_name: string | null; order_ref: string | null;
  segment: "recent" | "relaunch"; months_ago: number;
}

export function reviewUrlFor(t: Target): string {
  const mall = getMall(t.mall)!;
  const token = signReviewToken({
    mall: mall.id, productNo: t.product_no || 0, productName: t.product_name || "your Harriot watch",
    orderRef: t.order_ref || undefined, name: t.customer_name || undefined, email: t.email,
  });
  return `${BASE()}/review/${token}`;
}

function firstName(name: string | null): string {
  if (!name) return "there";
  return name.replace(/,/g, " ").trim().split(/\s+/)[0] || "there";
}

function button(url: string, label: string): string {
  return `<tr><td style="padding:26px 0 8px;"><a href="${url}" style="display:inline-block;background:${DARK};color:#fff;text-decoration:none;padding:15px 34px;font-size:15px;font-weight:600;letter-spacing:.4px;border-radius:6px;">${label}</a></td></tr>`;
}

function shell(inner: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:${DARK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:28px 14px;"><tr><td align="center">
    <table role="presentation" width="460" cellpadding="0" cellspacing="0" style="max-width:460px;background:#fff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${DARK};padding:24px;text-align:center;">
        <div style="color:${GOLD};font-size:12px;letter-spacing:3px;">HARRIOT</div>
        <div style="color:#fff;font-size:13px;letter-spacing:1px;margin-top:4px;">KOREAN-MADE WATCHES</div>
      </td></tr>
      <tr><td style="padding:30px 28px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table>
      </td></tr>
      <tr><td style="padding:0 28px 26px;color:#aaa;font-size:11px;line-height:1.6;">
        Harriot · Designed &amp; made in Korea · No login required, takes about a minute.<br>
        If this isn't for you, simply ignore this email.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export function buildEmail(t: Target): { subject: string; html: string } {
  const name = firstName(t.customer_name);
  const product = t.product_name || "your Harriot watch";
  const url = reviewUrlFor(t);
  const p = (s: string) => `<tr><td style="font-size:15px;line-height:1.75;color:#333;padding-bottom:12px;">${s}</td></tr>`;

  if (t.segment === "recent") {
    return {
      subject: `How's your Harriot ${product}?`,
      html: shell(
        p(`Hi ${name},`) +
        p(`Thank you for choosing Harriot. You recently received your <b>${product}</b> — we'd love to hear how it's going.`) +
        p(`Would you share a quick review? <b>Photos and a short video are especially welcome</b>, and earn a little extra as a thank-you.`) +
        button(url, "Leave a review →") +
        p(`<span style="font-size:13px;color:#888;">It takes about a minute — no account needed.</span>`) +
        p(`With gratitude,<br><b>Sungjo</b><br><span style="font-size:13px;color:#888;">Founder, Harriot</span>`)
      ),
    };
  }
  // relaunch
  return {
    subject: `Harriot has a new home — share your story?`,
    html: shell(
      p(`Hi ${name},`) +
      p(`Harriot has just relaunched at <b>harriotwatches.com</b>, and we're gathering stories from the owners who made this journey possible.`) +
      p(`You've had your <b>${product}</b> for a while now — we'd be honored if you shared a few words about it (and a photo or short video, if you'd like).`) +
      button(url, "Share my story →") +
      p(`<span style="font-size:13px;color:#888;">As a thank-you, we'll send you a reward — more for photo &amp; video reviews.</span>`) +
      p(`With gratitude,<br><b>Sungjo</b><br><span style="font-size:13px;color:#888;">Founder, Harriot</span>`)
    ),
  };
}

function encodeMimeHeader(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf-8").toString("base64")}?=`;
}

/**
 * 리뷰 요청 발송. 발신자 = 창업자 shong@harriotwatches.com (이미 연결된 google 토큰, gmail.modify).
 * shong@ 토큰이 없으면 연결된 해리엇 CS Gmail(harriotwatches@gmail.com)로 폴백.
 * 반환: gmail message id.
 */
export async function sendReviewRequest(to: string, subject: string, html: string): Promise<string> {
  let at = await getGoogleAccessTokenFromStore();
  let from = FOUNDER_FROM;
  if (!at) {
    const accounts = await listGmailAccounts();
    const acc = accounts.find((a) => a.brand === "harriot") || accounts[0];
    if (!acc) throw new Error("발송 가능한 Gmail 계정이 없습니다 (shong@ 미연결 + CS Gmail 없음)");
    at = await getGmailAccessToken(acc);
    const fromAddr = acc.displayName.includes("@") ? acc.displayName : "harriotwatches@gmail.com";
    from = `Harriot Watches <${fromAddr}>`;
  }
  const fromHeader = from.includes("<")
    ? from.replace(/^([^<]+)</, (_m, n) => `${encodeMimeHeader(n.trim())} <`)
    : encodeMimeHeader(from);
  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `MIME-Version: 1.0`,
  ];
  const raw = Buffer.from(headers.join("\r\n") + "\r\n\r\n" + html, "utf-8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail send 실패: ${await res.text()}`);
  const j = await res.json() as { id: string };
  return j.id;
}
