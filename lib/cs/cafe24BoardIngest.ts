import {
  fetchArticleComments,
  fetchBoardArticles,
  fetchBoards,
  fetchProduct,
  getMallOperatorId,
  type Cafe24Article,
  type Cafe24Board,
  type Cafe24Comment,
  type Cafe24Product,
  type Cafe24AttachFile,
  type MallId,
} from "../cafe24Client";
import { getAccessTokenFromStore } from "../cafe24TokenStore";
import { ingestMessage, patchMessageRaw, refreshThreadCustomer } from "./store";
import type { IngestPayload } from "./types";

/** 한 sync 내에서 상품 정보 캐시 (같은 product_no 가 여러 글에 반복되는 케이스 흔함) */
type ProductCache = Map<number, Cafe24Product | null>;

async function getProductCached(
  accessToken: string,
  productNo: number,
  cache: ProductCache,
  mall: MallId,
): Promise<Cafe24Product | null> {
  if (cache.has(productNo)) return cache.get(productNo) ?? null;
  const p = await fetchProduct(accessToken, productNo, mall);
  cache.set(productNo, p);
  return p;
}

/** 메시지 raw 에 첨부할 카페24 상품 카드 정보 — UI 에서 사용. */
interface CsCafe24ProductRef {
  productNo:   number;
  name?:       string;
  imageUrl?:   string | null;
  productCode?: string;
}

function pickProductImage(p: Cafe24Product): string | null {
  return p.list_image ?? p.tiny_image ?? p.detail_image ?? null;
}

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

function stripHtml(html?: string | null): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function articlePreview(article: Cafe24Article): string {
  return stripHtml(article.content);
}

/** 인박스 UI 가 읽는 첨부 형태. raw.attachments 로 저장된다. */
export interface CsAttachment {
  url:  string;
  name?: string;
  /** 이미지면 썸네일로, 아니면 파일 링크로 렌더. */
  isImage: boolean;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|heic|heif)(\?|$)/i;

/** "//ecimg.cafe24img.com/..." 처럼 프로토콜 상대경로로 오므로 https 를 붙인다. */
function absolutize(u: string): string {
  const t = u.trim();
  if (t.startsWith("//")) return "https:" + t;
  return t;
}

/**
 * 게시판 글·댓글의 첨부 추출.
 *
 * 카페24는 고객이 올린 사진을 본문 <img> 가 아니라 `attach_file_urls` 로 준다
 * (2026-08-26 실측: 폴바이스 문의하기 최근 25건 중 6건이 첨부 사진, 본문 <img> 는 0건).
 * 그래도 앱수집·이관 글은 본문에 이미지가 박혀 오는 경우가 있어 양쪽 다 훑는다.
 */
function extractAttachments(
  attachFiles: Cafe24AttachFile[] | null | undefined,
  content?: string | null,
): CsAttachment[] {
  const out: CsAttachment[] = [];
  const seen = new Set<string>();

  const push = (rawUrl: string | undefined, name?: string) => {
    if (!rawUrl) return;
    const url = absolutize(rawUrl);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url, name, isImage: IMAGE_EXT.test(url) || IMAGE_EXT.test(name ?? "") });
  };

  for (const f of Array.isArray(attachFiles) ? attachFiles : []) {
    if (f && typeof f === "object") push(f.url, f.name);
  }

  // 본문 <img> — 아이콘·스페이서 류는 첨부가 아니므로 제외.
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content ?? ""))) {
    if (/icon|blank|spacer|emoticon/i.test(m[1])) continue;
    push(m[1]);
  }
  return out;
}

/**
 * 본문에 첨부 표시를 덧붙인다.
 *
 * 목록 미리보기에서 "사진 있음"이 보여야 하고, 자동응대 AI 도 사진의 존재를 알아야
 * 한다 — 사진을 못 보는 채로 넘겨짚어 답하면 안 되기 때문(불확실하면 발송 금지).
 */
function withAttachmentNote(body: string, atts: CsAttachment[]): string {
  if (!atts.length) return body;
  const photos = atts.filter((a) => a.isImage).length;
  const files = atts.length - photos;
  const parts = [
    photos ? `사진 ${photos}장` : "",
    files ? `첨부파일 ${files}개` : "",
  ].filter(Boolean).join(", ");
  const note = `[${parts} 첨부됨]`;
  return body ? `${body}\n\n${note}` : note;
}

/**
 * 댓글 작성자가 고객인지 운영자인지 판별.
 * - 운영자: member_id가 몰 운영자 계정(operatorId)과 같거나, 작성자명이 "관리자"
 * - 고객: 원글 작성자와 member_id 또는 이름이 일치
 * 애매하면 운영자(out)로 두지 않고, 원글 작성자와 같을 때만 고객(in) → 고객 메시지 누락 방지 위해
 *   "명확히 운영자가 아니면서 원글 작성자와 일치"를 고객으로 본다.
 */
function commentIsCustomer(c: Cafe24Comment, article: Cafe24Article, operatorId: string): boolean {
  if (c.member_id && operatorId && c.member_id === operatorId) return false; // 운영자 계정
  if ((c.writer ?? "").trim() === "관리자") return false;
  if (article.member_id && c.member_id && c.member_id === article.member_id) return true;
  if (article.writer && c.writer && c.writer === article.writer) return true;
  // member_id 없는 댓글(운영자 패널 작성)인데 이름도 원글 작성자와 다르면 운영자측
  if (!c.member_id && c.writer !== article.writer) return false;
  return false;
}

export interface SyncBoardsOpts {
  /** 며칠 전까지 훑을지. 기본 14일. */
  days?: number;
  /**
   * 첨부 백필 전용 모드 — 메시지를 새로 넣지 않고, 이미 있는 메시지의 raw 에
   * 첨부(사진)만 채운다. 창을 90일로 넓혀 과거 글의 사진을 살릴 때 쓴다.
   * 이 모드가 없으면 넓힌 창에 걸린 옛 문의가 통째로 "미답변"으로 인박스에 쏟아진다.
   */
  backfillOnly?: boolean;
}

export async function syncCafe24Boards(
  mall: MallId = "paulvice",
  opts: SyncBoardsOpts = {},
): Promise<{
  boards: number;
  boardNames?: string[];
  articles: number;
  inserted: number;
  skipped: number;
  /** 이미 있던 메시지에 첨부(사진)를 뒤늦게 붙인 건수. */
  backfilled: number;
  errors: string[];
  newInboundThreadIds: string[]; // 이번에 새로 적재된 고객(in) 메시지의 스레드 — 자동응대 트리거용
}> {
  const errors: string[] = [];
  const newInbound = new Set<string>();
  // 스레드/메시지 id 네임스페이스 — 몰별 board_no/article_no 충돌 방지(store 중복판정=channel+id).
  // 폴바이스는 기존 id 유지(후방호환), 해리엇 등은 몰 접두.
  const idPrefix = mall === "paulvice" ? "cafe24" : `${mall}_cafe24`;
  const accessToken = await getAccessTokenFromStore(mall);
  if (!accessToken) {
    return {
      boards: 0,
      articles: 0,
      inserted: 0,
      skipped: 0,
      backfilled: 0,
      errors: [
        `Cafe24 토큰 없음(${mall}) — 대시보드에서 Cafe24 재연결 필요 (mall.read_community 스코프 추가)`,
      ],
      newInboundThreadIds: [],
    };
  }

  let allBoards: Cafe24Board[] = [];
  try {
    allBoards = await fetchBoards(accessToken, mall);
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
    return { boards: 0, articles: 0, inserted: 0, skipped: 0, backfilled: 0, errors, newInboundThreadIds: [] };
  }

  const csBoards = allBoards.filter(isCsBoard);
  if (csBoards.length === 0) {
    errors.push(
      `CS 게시판을 찾지 못함. 확인한 게시판: ${allBoards.map((b) => b.board_name).join(", ") || "없음"}`
    );
    return { boards: 0, articles: 0, inserted: 0, skipped: 0, backfilled: 0, errors, newInboundThreadIds: [] };
  }

  const backfillOnly = opts.backfillOnly === true;
  const sinceDate = new Date(Date.now() - (opts.days ?? 14) * 24 * 60 * 60 * 1000);
  let totalArticles = 0;
  let inserted = 0;
  let skipped = 0;
  let backfilled = 0;
  const boardNames = csBoards.map((b) => b.board_name);
  const productCache: ProductCache = new Map();
  const operatorId = getMallOperatorId(mall); // 운영자 댓글 판별용 (예: icaruse2000)

  for (const board of csBoards) {
    let articles: Cafe24Article[] = [];
    try {
      articles = await fetchBoardArticles(accessToken, board.board_no, {
        limit: 50,
        sinceDate,
      }, mall);
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
      const bfThreadId = `${idPrefix}_${board.board_no}_${article.article_no}`;

      // 백필 모드 — 새 메시지·상품조회·스레드갱신 전부 생략하고 첨부만 채운다.
      if (backfillOnly) {
        const atts = extractAttachments(article.attach_file_urls, article.content);
        if (atts.length) {
          try {
            if (await patchMessageRaw(`${bfThreadId}_article`, { attachments: atts })) backfilled++;
          } catch (e) {
            errors.push(`[${board.board_name}#${article.article_no}] 첨부 백필 실패: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        try {
          for (const c of await fetchArticleComments(accessToken, board.board_no, article.article_no, mall)) {
            const cAtts = extractAttachments(c.attach_file_urls, c.content);
            if (!cAtts.length) continue;
            if (await patchMessageRaw(`${bfThreadId}_comment_${c.comment_no}`, { attachments: cAtts })) backfilled++;
          }
        } catch { /* 댓글 조회 실패는 무시 — 원글 첨부가 주 목적 */ }
        continue;
      }

      // 글에 product_no 있으면 상품 정보 가져옴 (캐시 활용)
      let productRef: CsCafe24ProductRef | undefined;
      let subjectPrefix = `[${board.board_name}]`;
      if (article.product_no && article.product_no > 0) {
        const product = await getProductCached(accessToken, article.product_no, productCache, mall);
        if (product) {
          productRef = {
            productNo:   product.product_no,
            name:        product.product_name,
            imageUrl:    pickProductImage(product),
            productCode: product.product_code,
          };
          // 상품명을 제목 앞에 — 목록에서도 어떤 상품인지 즉시 보임
          if (product.product_name) {
            const shortName = product.product_name.length > 25
              ? product.product_name.slice(0, 25) + "…"
              : product.product_name;
            subjectPrefix = `[${board.board_name} · ${shortName}]`;
          }
        }
      }

      const threadId = `${idPrefix}_${board.board_no}_${article.article_no}`;

      // 고객이 붙인 사진 — 카페24는 attach_file_urls 로 준다. 이게 빠지면 사장님이
      // 인박스를 보고도 카페24 관리자 페이지를 또 열어야 한다(이중 작업).
      const articleAtts = extractAttachments(article.attach_file_urls, article.content);
      const articleMsgId = `${threadId}_article`;

      // 1) 고객 글 (수신)
      const inPayload: IngestPayload = {
        brand: mall,
        channel: "cafe24_board",
        externalThreadId: threadId,
        externalMessageId: articleMsgId,
        customerHandle: article.writer_email ?? article.member_id ?? undefined,
        customerName: writerName,
        subject: `${subjectPrefix} ${article.title}`,
        bodyText: withAttachmentNote(preview || article.title, articleAtts),
        sentAt: new Date(article.created_date),
        direction: "in",
        raw: {
          board_no: board.board_no,
          board_name: board.board_name,
          article,
          ...(productRef ? { cafe24Product: productRef } : {}),
          ...(articleAtts.length ? { attachments: articleAtts } : {}),
        },
      };

      const r1 = await ingestMessage(inPayload);
      if (r1.inserted) { inserted++; newInbound.add(r1.threadId); }
      else {
        skipped++;
        // 이미 적재된 글 — 첨부는 이번에 처음 뽑는 정보라 raw 에 뒤늦게 붙여준다.
        // (ingestMessage 는 중복이면 raw 를 갱신하지 않는다)
        if (articleAtts.length) {
          try {
            if (await patchMessageRaw(articleMsgId, { attachments: articleAtts })) backfilled++;
          } catch (e) {
            errors.push(`[${board.board_name}#${article.article_no}] 첨부 백필 실패: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      // 2) 운영자 답글이 이미 있으면 placeholder 메시지 추가 → 상태를 waiting으로
      if (hasReply) {
        const outPayload: IngestPayload = {
          brand: mall,
          channel: "cafe24_board",
          externalThreadId: threadId,
          externalMessageId: `${threadId}_adminreply`,
          customerHandle: article.writer_email ?? article.member_id ?? undefined,
          customerName: writerName,
          subject: `${subjectPrefix} ${article.title}`,
          bodyText: "(운영자 답변 완료 — 카페24 관리자 페이지에서 확인)",
          sentAt: new Date(article.created_date),
          direction: "out",
          raw: { reply_placeholder: true, reply_user_id: article.reply_user_id },
        };
        const r2 = await ingestMessage(outPayload);
        if (r2.inserted) inserted++;
        else skipped++;
      }

      // 2-b) 댓글(운영자 답변·고객 재답글) — 실제 대화. 같은 스레드에 시간순으로 적재.
      try {
        const comments = await fetchArticleComments(accessToken, board.board_no, article.article_no, mall);
        for (const c of comments) {
          const fromCustomer = commentIsCustomer(c, article, operatorId);
          const cBody = stripHtml(c.content).slice(0, 1000);
          const cAtts = extractAttachments(c.attach_file_urls, c.content);
          const cMsgId = `${threadId}_comment_${c.comment_no}`;
          const cPayload: IngestPayload = {
            brand: mall,
            channel: "cafe24_board",
            externalThreadId: threadId,
            externalMessageId: cMsgId,
            customerHandle: article.writer_email ?? article.member_id ?? undefined,
            customerName: writerName,
            subject: `${subjectPrefix} ${article.title}`,
            bodyText: withAttachmentNote(cBody, cAtts) || "(내용 없음)",
            sentAt: new Date(c.created_date),
            direction: fromCustomer ? "in" : "out",
            raw: {
              comment: c,
              comment_writer: c.writer,
              board_no: board.board_no,
              ...(cAtts.length ? { attachments: cAtts } : {}),
            },
          };
          const rc = await ingestMessage(cPayload);
          if (rc.inserted) { inserted++; if (fromCustomer) newInbound.add(rc.threadId); }
          else {
            skipped++;
            if (cAtts.length) {
              try {
                if (await patchMessageRaw(cMsgId, { attachments: cAtts })) backfilled++;
              } catch { /* 댓글 백필 실패는 조용히 — 원글 첨부가 주 목적 */ }
            }
          }
        }
      } catch (e) {
        errors.push(
          `[${board.board_name}#${article.article_no}] 댓글 조회 실패: ${e instanceof Error ? e.message : String(e)}`
        );
      }

      // 답장으로 지워진 고객 정보 보충 (dup 메시지여도 스레드 갱신)
      await refreshThreadCustomer(
        "cafe24_board",
        threadId,
        {
          handle: article.writer_email ?? article.member_id ?? undefined,
          name: writerName,
        }
      );
    }
  }

  return {
    boards: csBoards.length,
    boardNames,
    articles: totalArticles,
    inserted,
    skipped,
    backfilled,
    errors,
    newInboundThreadIds: [...newInbound],
  };
}
