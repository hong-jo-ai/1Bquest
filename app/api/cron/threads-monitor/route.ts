export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getThreadsTokenFromStore } from "@/lib/threadsTokenStore";
import { getRecentPublished, getNotifiedIds, markNotified } from "@/lib/threadsScheduler";

const THREADS_BASE = "https://graph.threads.net/v1.0";
const NOTIFY_EMAIL = "shong@harriotwatches.com";
const LIKE_THRESHOLD = 30;
const REPLY_THRESHOLD = 20;

/**
 * 매일 1회 실행
 * 최근 15일 이내 게시물의 좋아요/댓글 수를 확인
 * 기준 초과 시 이메일 알림
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await getThreadsTokenFromStore();
  if (!token) {
    return NextResponse.json({ error: "Threads 토큰 없음" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "RESEND_API_KEY 미설정" }, { status: 500 });
  }

  const published = await getRecentPublished();
  if (published.length === 0) {
    return NextResponse.json({ success: true, message: "모니터링할 게시물 없음" });
  }

  const notified = await getNotifiedIds();
  const hits: { threadId: string; text: string; likes: number; replies: number; publishedAt: string }[] = [];

  for (const post of published) {
    if (notified.has(post.threadId)) continue;

    try {
      const res = await fetch(
        `${THREADS_BASE}/${post.threadId}?fields=id,text,like_count,reply_count&access_token=${token}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const likes = data.like_count ?? 0;
      const replies = data.reply_count ?? 0;

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

  if (hits.length === 0) {
    return NextResponse.json({ success: true, message: "기준 초과 게시물 없음", checked: published.length });
  }

  // 이메일 발송
  const resend = new Resend(resendKey);
  const postRows = hits.map((h) => {
    const date = new Date(h.publishedAt).toLocaleDateString("ko-KR");
    const preview = h.text.length > 80 ? h.text.slice(0, 80) + "…" : h.text;
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${preview}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:${h.likes >= LIKE_THRESHOLD ? '#e11d48' : '#71717a'}">❤️ ${h.likes}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:${h.replies >= REPLY_THRESHOLD ? '#7c3aed' : '#71717a'}">💬 ${h.replies}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;font-size:12px;color:#a1a1aa">${date}</td>
    </tr>`;
  }).join("");

  try {
    await resend.emails.send({
      from: "PAULVICE Dashboard <onboarding@resend.dev>",
      to: NOTIFY_EMAIL,
      subject: `[PAULVICE] Threads 인기 게시물 ${hits.length}건 발견!`,
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#18181b;margin-bottom:4px">Threads 성과 알림</h2>
          <p style="color:#71717a;font-size:14px;margin-top:0">좋아요 ${LIKE_THRESHOLD}+ 또는 댓글 ${REPLY_THRESHOLD}+ 기준 초과 게시물</p>
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
          <p style="font-size:12px;color:#a1a1aa;margin-top:24px">
            PAULVICE Dashboard 자동 알림 ·
            <a href="https://paulvice-dashboard.vercel.app/tools/threads" style="color:#7c3aed">대시보드 바로가기</a>
          </p>
        </div>
      `,
    });
    console.log(`[Cron:threads-monitor] 알림 이메일 발송 — ${hits.length}건`);
  } catch (e: any) {
    console.error("[Cron:threads-monitor] 이메일 발송 실패:", e);
    return NextResponse.json({ error: `이메일 실패: ${e.message}`, hits }, { status: 500 });
  }

  return NextResponse.json({ success: true, notified: hits.length, checked: published.length });
}
