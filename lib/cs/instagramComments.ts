/**
 * 인스타 댓글 → CS 통합 인박스 (`ig_comment`).
 *
 * ⚠️ 2026-09-01 신규. 그전까지 `ig_comment` 는 **채널 라벨만 있고 수집이 없었다** —
 *    types.ts·인박스 아이콘엔 있는데 인제스트 코드가 한 줄도 없어 두 달간 0건이었다.
 *    (7월 메모의 "IG 댓글 작동"은 권한 확인용 수동 조회였지 인제스트가 아니었다.)
 *
 * 모델: **최상위 댓글 하나 = 스레드 하나.** 대댓글은 그 스레드의 메시지로 붙는다.
 *   게시물 단위로 묶으면 서로 무관한 고객들이 한 스레드에 섞여 답을 달 수 없다.
 *   카페24 게시판이 "원글 + 댓글 전체 = 한 대화"인 것과 같은 결.
 *
 * 경로: IG 로그인 토큰(IGAA) + graph.instagram.com. DM 과 같은 토큰을 쓴다.
 */
import { ingestMessage } from "./store";
import {
  igCommentsForMedia,
  listIgMedia,
  listIgAccounts,
  refreshIgLoginTokenIfNeeded,
  type IgComment,
  type IgMedia,
} from "./instagramClient";
import type { IngestPayload } from "./types";

export interface IgCommentSyncResult {
  accounts: number;
  media: number;
  inserted: number;
  skipped: number;
  /** 작성자를 못 알아낸 대댓글 — 방향 판정 불가라 적재하지 않은 수. 0 이 정상. */
  unknownAuthor: number;
  errors: string[];
}

/**
 * 우리가 단 댓글인가 — 브랜드 계정 유저네임과 같으면 아웃바운드.
 * ⚠️ cs_accounts.display_name 은 `@harriotwatches` 처럼 @ 가 붙어 있는데
 *    Meta 가 주는 username 은 `harriotwatches` 다. 그냥 비교하면 항상 어긋나
 *    우리가 쓴 댓글이 전부 고객 문의로 들어온다(2026-09-01 실측).
 */
const bareHandle = (v: string) => v.trim().replace(/^@/, "").toLowerCase();

function isOwn(c: IgComment, ownUsername: string): boolean {
  const u = bareHandle(c.username ?? c.from?.username ?? "");
  return Boolean(u) && u === bareHandle(ownUsername);
}

/** 캡션 한 줄 요약 — 인박스에서 "어느 글에 달린 댓글인지" 한눈에 알아보게. */
function captionLine(caption?: string): string {
  const one = (caption ?? "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  // 해시태그 뭉치는 제목으로 쓸모없다 — 본문만 남긴다.
  const body = one.replace(/(^|\s)#[^\s#]+/g, " ").replace(/\s+/g, " ").trim();
  const text = body || one;
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

function payloadFor(
  brand: IngestPayload["brand"],
  root: IgComment,
  c: IgComment,
  ownUsername: string,
  post: IgMedia,
): IngestPayload {
  // 스레드의 "고객"은 **최상위 댓글 작성자**로 고정한다. 메시지 작성자를 쓰면
  // 우리가 답글을 다는 순간 스레드 주인이 우리로 바뀐다(2026-09-01 실측).
  const rootHandle = bareHandle(root.username ?? root.from?.username ?? "");
  return {
    brand,
    channel: "ig_comment",
    // 최상위 댓글 id 가 스레드 키 — 대댓글도 같은 스레드로 모인다.
    externalThreadId: `igc:${root.id}`,
    externalMessageId: `igc:${c.id}`,
    customerHandle: rootHandle ? `@${rootHandle}` : undefined,
    customerName: rootHandle || undefined,
    // URL 만 있으면 눌러보기 전엔 어느 글인지 모른다 → 캡션 한 줄을 제목으로 쓴다.
    subject: captionLine(post.caption) || post.permalink,
    bodyText: c.text ?? "",
    sentAt: new Date(c.timestamp),
    direction: isOwn(c, ownUsername) ? "out" : "in",
    // ⚠️ 썸네일 URL 은 저장하지 않는다(서명 CDN, 몇 시간이면 만료).
    //    id 만 두고 볼 때 /api/cs/instagram/media 로 새로 받는다.
    raw: {
      comment: c,
      post: {
        id: post.id,
        permalink: post.permalink,
        caption: post.caption,
        mediaType: post.media_type,
        timestamp: post.timestamp,
      },
    },
  };
}

export async function syncAllIgComments(
  opts: { sinceDays?: number; maxPages?: number } = {},
): Promise<IgCommentSyncResult> {
  const accounts = await listIgAccounts();
  const since = opts.sinceDays
    ? new Date(Date.now() - opts.sinceDays * 86_400_000)
    : undefined;
  // 게시물은 최신 것부터 — 오래된 글에 새 댓글이 달리는 일은 드물다.
  const mediaLimit = Math.max(5, (opts.maxPages ?? 1) * 10);

  let media = 0;
  let inserted = 0;
  let skipped = 0;
  let unknownAuthor = 0;
  const errors: string[] = [];

  for (let account of accounts) {
    try {
      account = await refreshIgLoginTokenIfNeeded(account);
      if (!account.igLoginToken) {
        // 페이지 토큰 경로로는 댓글을 안 읽는다 — code 3 로 죽던 경로다.
        errors.push(`${account.displayName}: IG 로그인 토큰 없음 — 댓글 수집 건너뜀`);
        continue;
      }

      const posts = await listIgMedia(account, { limit: mediaLimit });
      for (const post of posts) {
        media++;
        let comments: IgComment[];
        try {
          comments = await igCommentsForMedia(account, post.id, {
            hydrateRepliesSince: since,
          });
        } catch (e) {
          errors.push(
            `${account.displayName} media ${post.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
          continue;
        }

        // ⚠️ Meta 는 **답글을 최상위 목록에도 중복해서** 준다(2026-09-01 실측).
        //    거르지 않으면 답글이 부모 대화에 붙지 않고 자기 스레드를 따로 만들고,
        //    그 스레드의 고객이 우리 계정이 된다.
        const replyIds = new Set(
          comments.flatMap((c) => (c.replies?.data ?? []).map((r) => r.id)),
        );

        for (const root of comments) {
          if (replyIds.has(root.id)) continue; // 부모 쪽에서 이미 처리한다
          const replies = root.replies?.data ?? [];
          // 우리가 쓴 최상위 댓글에 답글도 없으면 해시태그 등 자체 게시물 부속 —
          // 고객 대화가 아니므로 인박스에 스레드를 만들지 않는다.
          if (isOwn(root, account.displayName) && replies.length === 0) continue;

          // 최상위 댓글 + 대댓글을 한 스레드에 시간순으로 넣는다.
          const chain = [root, ...replies].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          );
          // 스레드 전체가 창 밖이면 통째로 건너뛴다(오래된 글 재수집 비용 절약).
          if (since && chain.every((c) => new Date(c.timestamp).getTime() < since.getTime())) {
            continue;
          }
          for (const c of chain) {
            if (!c.text?.trim()) continue;
            // 작성자를 모르면 방향을 정할 수 없다. "in" 으로 넣으면 우리가 단 답글이
            // 미답변으로 쌓이고, "out" 으로 넣으면 진짜 문의를 놓친다 → 넣지 않고 센다.
            // (개별 조회로 거의 다 채워지므로 여기 걸리는 건 예외적이어야 한다.)
            if (!(c.username ?? c.from?.username)) {
              unknownAuthor++;
              continue;
            }
            try {
              const res = await ingestMessage(
                payloadFor(account.brand, root, c, account.displayName, post),
              );
              if (res.inserted) inserted++;
              else skipped++;
            } catch (e) {
              errors.push(
                `${account.displayName} comment ${c.id}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        }
      }
    } catch (e) {
      errors.push(`${account.displayName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { accounts: accounts.length, media, inserted, skipped, unknownAuthor, errors };
}
