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
 * Cafe24 API: reply 필드가 "T"이면 답글 존재, "F"이면 미답변.
 * reply_user_id가 있으면 추가로 답변자 id가 찍혀있음.
 */
function hasAdminReply(article: Cafe24Article): boolean {
  return article.reply === "T";
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
  boardNames?: string[];
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
  const boardNames = csBoards.map((b) => b.board_name);

  for (const board of csBoards) {
    let articles: Cafe24Article[] = [];
    try {
      articles = await fetchBoardArticles(accessToken, board.board_no, {
        limit: 50,
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
      if (article.deleted === "T") {
        skipped++;
        continue;
      }

      const hasReply = hasAdminReply(article);
      const preview = articlePreview(article).slice(0, 500);
      const writerName = article.writer ?? "(익명)";

      // 1) 고객 글 (수신)
      const inPayload: IngestPayload = {
        brand: "paulvice",
        channel: "cafe24_board",
        externalThreadId: `cafe24_${board.board_no}_${article.article_no}`,
        externalMessageId: `cafe24_${board.board_no}_${article.article_no}_article`,
        customerHandle: article.writer_email ?? article.member_id ?? undefined,
        customerName: writerName,
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

      // 2) 운영자 답글이 이미 있으면 placeholder 메시지 추가 → 상태를 waiting으로
      if (hasReply) {
        const outPayload: IngestPayload = {
          brand: "paulvice",
          channel: "cafe24_board",
          externalThreadId: `cafe24_${board.board_no}_${article.article_no}`,
          externalMessageId: `cafe24_${board.board_no}_${article.article_no}_adminreply`,
          customerHandle: article.writer_email ?? article.member_id ?? undefined,
          customerName: writerName,
          subject: `[${board.board_name}] ${article.title}`,
          bodyText: "(운영자 답변 완료 — 카페24 관리자 페이지에서 확인)",
          sentAt: new Date(article.created_date),
          direction: "out",
          raw: { reply_placeholder: true, reply_user_id: article.reply_user_id },
        };
        const r2 = await ingestMessage(outPayload);
        if (r2.inserted) inserted++;
        else skipped++;
      }
    }
  }

  return {
    boards: csBoards.length,
    boardNames,
    articles: totalArticles,
    inserted,
    skipped,
    errors,
  };
}
