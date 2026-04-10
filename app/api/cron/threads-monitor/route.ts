export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";
import { getRecentPublished, getNotifiedIds, markNotified, getPostQueue } from "@/lib/threadsScheduler";
import type { BrandId } from "@/lib/threadsBrands";

const THREADS_BASE = "https://graph.threads.net/v1.0";
const NOTIFY_EMAIL = "shong@harriotwatches.com";
const LIKE_THRESHOLD = 30;
const REPLY_THRESHOLD = 20;

async function sendGmail(accessToken: string, to: string, subject: string, htmlBody: string) {
  // RFC 2822 형식 이메일 생성
  const raw = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    htmlBody,
  ].join("\r\n");

  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail 발송 실패: ${err}`);
  }
  return res.json();
}

/**
 * 매일 1회 실행
 * 최근 15일 이내 게시물의 좋아요/댓글 수를 확인
 * 기준 초과 시 Gmail로 이메일 알림
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const published = await getRecentPublished();
  if (published.length === 0) {
    return NextResponse.json({ success: true, message: "모니터링할 게시물 없음" });
  }

  const notified = await getNotifiedIds();
  const hits: { threadId: string; text: string; likes: number; replies: number; publishedAt: string }[] = [];

  for (const post of published) {
    if (notified.has(post.threadId)) continue;

    const brand = (post.brand ?? "paulvice") as BrandId;
    const threadsToken = await getThreadsTokenFromStore(brand);
    if (!threadsToken) continue;

    try {
      const insRes = await fetch(
        `${THREADS_BASE}/${post.threadId}/insights?metric=likes,replies&access_token=${threadsToken}`,
        { cache: "no-store" }
      );
      if (!insRes.ok) continue;
      const ins = await insRes.json();
      let likes = 0, replies = 0;
      for (const m of ins.data ?? []) {
        if (m.name === "likes") likes = m.values?.[0]?.value ?? 0;
        if (m.name === "replies") replies = m.values?.[0]?.value ?? 0;
      }

      if (likes >= LIKE_THRESHOLD || replies >= REPLY_THRESHOLD) {
        hits.push({
          threadId: post.threadId,
          text: post.text,
          likes,
          replies,
          publishedAt: post.publishedAt,
        });
        await markNotified(post.threadId);
      }
    } catch {
      // 개별 조회 실패는 무시
    }
  }

  // ── 큐 부족 체크 ────────────────────────────────────────────────────────
  const queue = await getPostQueue();
  const autopostSettings = await (await import("@/lib/threadsScheduler")).getAutopostSettings();
  const dailyPosts: Record<string, number> = {
    paulvice: autopostSettings.paulvice?.postsPerDay ?? 8,
    harriot: autopostSettings.harriot?.postsPerDay ?? 8,
    hongsungjo: autopostSettings.hongsungjo?.postsPerDay ?? 2,
  };
  const brandNames: Record<string, string> = { paulvice: "폴바이스", harriot: "해리엇", hongsungjo: "홍성조" };
  const lowBrands: { brand: string; name: string; count: number; daily: number }[] = [];

  for (const b of ["paulvice", "harriot", "hongsungjo"]) {
    const count = queue.filter((p) => (p.brand ?? "paulvice") === b).length;
    if (count < dailyPosts[b]) {
      lowBrands.push({ brand: b, name: brandNames[b], count, daily: dailyPosts[b] });
    }
  }

  if (hits.length === 0 && lowBrands.length === 0) {
    return NextResponse.json({ success: true, message: "기준 초과 게시물 없음, 큐 충분", checked: published.length });
  }

  // Gmail로 이메일 발송
  const gmailToken = await getGoogleAccessTokenFromStore();
  if (!gmailToken) {
    return NextResponse.json({ error: "Google 토큰 없음 — 방문자 페이지에서 Google 재로그인 필요", hits }, { status: 401 });
  }

  // 큐 부족 알림 HTML
  const queueWarningHtml = lowBrands.length > 0 ? `
    <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;padding:16px;margin-bottom:20px">
      <h3 style="color:#92400e;margin:0 0 8px 0;font-size:15px">자동 게시 큐 부족 경고</h3>
      <p style="color:#a16207;font-size:13px;margin:0 0 12px 0">아래 브랜드의 자동 게시 큐가 부족합니다.</p>
      ${lowBrands.map((b) => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #fde68a">
          <span style="font-weight:600;color:#92400e">${b.name}</span>
          <span style="color:${b.count === 0 ? '#dc2626' : '#d97706'};font-weight:bold">${b.count}개 남음 (하루 ${b.daily}회)${b.count === 0 ? ' — 게시 불가!' : ''}</span>
        </div>
      `).join("")}
      <p style="color:#a16207;font-size:12px;margin:12px 0 0 0">
        <a href="https://paulvice-dashboard.vercel.app/tools/threads" style="color:#7c3aed;font-weight:600">대시보드에서 글 추가하기 →</a>
      </p>
    </div>
  ` : "";

  const postRows = hits.map((h) => {
    const date = new Date(h.publishedAt).toLocaleDateString("ko-KR");
    const preview = h.text.length > 80 ? h.text.slice(0, 80) + "..." : h.text;
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${preview}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:${h.likes >= LIKE_THRESHOLD ? '#e11d48' : '#71717a'}">&#10084; ${h.likes}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:${h.replies >= REPLY_THRESHOLD ? '#7c3aed' : '#71717a'}">&#128172; ${h.replies}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-size:12px;color:#a1a1aa">${date}</td>
    </tr>`;
  }).join("");

  const hitsSection = hits.length > 0 ? `
    <h2 style="color:#18181b;margin-bottom:4px">Threads 인기 게시물</h2>
    <p style="color:#71717a;font-size:14px;margin-top:0">좋아요 ${LIKE_THRESHOLD}+ 또는 댓글 ${REPLY_THRESHOLD}+ 기준 초과</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead>
        <tr style="background:#f4f4f5">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#71717a">게시물</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#71717a">좋아요</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#71717a">댓글</th>
          <th style="padding:8px 12px;text-align:center;font-size:12px;color:#71717a">게시일</th>
        </tr>
      </thead>
      <tbody>${postRows}</tbody>
    </table>
  ` : "";

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
      ${queueWarningHtml}
      ${hitsSection}
      <p style="font-size:12px;color:#a1a1aa;margin-top:24px">
        PAULVICE Dashboard 자동 알림
      </p>
    </div>
  `;

  try {
    const subject = hits.length > 0 && lowBrands.length > 0
      ? `[PAULVICE] 인기 게시물 ${hits.length}건 + 큐 부족 ${lowBrands.length}개 브랜드`
      : hits.length > 0
      ? `[PAULVICE] Threads 인기 게시물 ${hits.length}건 발견!`
      : `[PAULVICE] Threads 자동 게시 큐 부족 — ${lowBrands.map(b => b.name).join(", ")}`;
    await sendGmail(gmailToken, NOTIFY_EMAIL, subject, html);
    console.log(`[Cron:threads-monitor] Gmail 알림 발송 — ${hits.length}건`);
  } catch (e: any) {
    console.error("[Cron:threads-monitor] Gmail 발송 실패:", e);
    return NextResponse.json({ error: `이메일 실패: ${e.message}`, hits }, { status: 500 });
  }

  return NextResponse.json({ success: true, notified: hits.length, checked: published.length });
}
