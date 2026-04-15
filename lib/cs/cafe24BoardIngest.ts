import {
  fetchBoardArticles,
  fetchBoards,
  type Cafe24Article,
  type Cafe24Board,
} from "../cafe24Client";
import { getAccessTokenFromStore } from "../cafe24TokenStore";
import { ingestMessage } from "./store";
import type { IngestPayload } from "./types";

/**
 * CS 관련 게시판 판별. 이름에 아래 키워드가 포함되면 CS 대상으로 간주.
 * 리뷰/공지/이벤트 등은 제외.
 */
const CS_BOARD_PATTERNS = [
  /1:1/,
  /문의/,
  /상담/,
  /Q&A/i,
  /QnA/i,
  /qna/i,
  /질문/,
  /inquiry/i,
];

function isCsBoard(board: Cafe24Board): boolean {
  return CS_BOARD_PATTERNS.some((r) => r.test(board.board_name));
}

/**
 * 해당 글에 운영자 답글이 있는지 판별.
 * 1) article.reply 필드가 있으면 답글 있음
 * 2) comments 배열에 is_admin_user='T' 댓글이 있으면 답글 있음
 */
function hasAdminReply(article: Cafe24Article): boolean {
  if (article.reply && article.reply.trim().length > 0) return true;
  if (article.comments?.some((c) => c.is_admin_user === "T")) return true;
  return false;
}

function articlePreview(article: Cafe24Article): string {
  if (!article.content) return "";
  // HTML 태그 제거
  return article.content
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function syncCafe24Boards(): Promise<{
  boards: number;
  articles: number;
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const accessToken = await getAccessTokenFromStore();
  if (!accessToken) {
    return {
      boards: 0,
      articles: 0,
      inserted: 0,
      skipped: 0,
      errors: [
        "Cafe24 토큰 없음 — 대시보드에서 Cafe24 재연결 필요 (mall.read_community 스코프 추가)",
      ],
    };
  }

  let allBoards: Cafe24Board[] = [];
  try {
    allBoards = await fetchBoards(accessToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 스코프 없으면 403/401 에러
    if (msg.includes("scope") || msg.includes("403") || msg.includes("401")) {
      errors.push(
        `게시판 목록 조회 실패 (스코프 누락 가능): ${msg}. 대시보드에서 Cafe24 재연결 필요.`
      );
    } else {
      errors.push(`게시판 목록 조회 실패: ${msg}`);
    }
    return { boards: 0, articles: 0, inserted: 0, skipped: 0, errors };
  }

  const csBoards = allBoards.filter(isCsBoard);
  if (csBoards.length === 0) {
    errors.push(
      `CS 게시판을 찾지 못함. 확인한 게시판: ${allBoards.map((b) => b.board_name).join(", ") || "없음"}`
    );
    return { boards: 0, articles: 0, inserted: 0, skipped: 0, errors };
  }

  const sinceDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  let totalArticles = 0;
  let inserted = 0;
  let skipped = 0;

  for (const board of csBoards) {
    let articles: Cafe24Article[] = [];
    try {
      articles = await fetchBoardArticles(accessToken, board.board_no, {
        limit: 30,
        sinceDate,
      });
    } catch (e) {
      errors.push(
        `[${board.board_name}] 글 조회 실패: ${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }
    totalArticles += articles.length;

    for (const article of articles) {
      const hasReply = hasAdminReply(article);
      const preview = articlePreview(article).slice(0, 200);

      // 1) 고객 글 (수신)
      const inPayload: IngestPayload = {
        brand: "paulvice",
        channel: "cafe24_board",
        externalThreadId: `cafe24_${board.board_no}_${article.article_no}`,
        externalMessageId: `cafe24_${board.board_no}_${article.article_no}_article`,
        customerHandle: article.writer_email ?? article.writer_id ?? undefined,
        customerName: article.writer_name ?? undefined,
        subject: `[${board.board_name}] ${article.title}`,
        bodyText: preview || article.title,
        sentAt: new Date(article.created_date),
        direction: "in",
        raw: {
          board_no: board.board_no,
          board_name: board.board_name,
          article,
        },
      };

      const r1 = await ingestMessage(inPayload);
      if (r1.inserted) inserted++;
      else skipped++;

      // 2) 답글이 이미 있으면 상태를 waiting으로 맞춤 + 답글도 메시지로 추가
      if (hasReply) {
        // article.reply가 있으면 운영자 답변을 out 메시지로 추가
        if (article.reply) {
          const outPayload: IngestPayload = {
            brand: "paulvice",
            channel: "cafe24_board",
            externalThreadId: `cafe24_${board.board_no}_${article.article_no}`,
            externalMessageId: `cafe24_${board.board_no}_${article.article_no}_reply`,
            customerHandle: article.writer_email ?? article.writer_id ?? undefined,
            customerName: article.writer_name ?? undefined,
            subject: `[${board.board_name}] ${article.title}`,
            bodyText: article.reply.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
            sentAt: new Date(article.created_date),
            direction: "out",
            raw: { reply_from_article: true },
          };
          const r2 = await ingestMessage(outPayload);
          if (r2.inserted) inserted++;
          else skipped++;
        }

        // comments 배열에 admin 답글이 있으면 추가
        for (const c of article.comments ?? []) {
          if (c.is_admin_user !== "T" || !c.content) continue;
          const commentPayload: IngestPayload = {
            brand: "paulvice",
            channel: "cafe24_board",
            externalThreadId: `cafe24_${board.board_no}_${article.article_no}`,
            externalMessageId: `cafe24_${board.board_no}_${article.article_no}_comment_${c.comment_no}`,
            customerHandle: article.writer_email ?? undefined,
            customerName: article.writer_name ?? undefined,
            subject: `[${board.board_name}] ${article.title}`,
            bodyText: c.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
            sentAt: new Date(c.created_date ?? article.created_date),
            direction: "out",
            raw: { admin_comment: c },
          };
          const rc = await ingestMessage(commentPayload);
          if (rc.inserted) inserted++;
          else skipped++;
        }
      }
    }
  }

  return {
    boards: csBoards.length,
    articles: totalArticles,
    inserted,
    skipped,
    errors,
  };
}
