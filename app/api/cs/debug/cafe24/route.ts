import { cafe24Get } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BASE_URL = `https://${process.env.CAFE24_MALL_ID}.cafe24api.com`;

/**
 * POST /api/cs/debug/cafe24
 * body: { boardNo, articleNo, payloadVariant }
 * 다양한 payload 포맷을 시도해서 Cafe24 답변 등록 성공하는 것 찾기
 */
export async function POST(req: Request) {
  const accessToken = await getAccessTokenFromStore();
  if (!accessToken) {
    return Response.json({ error: "no token" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const boardNo = body.boardNo ?? 6;
  const articleNo = body.articleNo ?? 0;
  const content = body.content ?? "디버그 테스트 답변";
  const variant = body.variant ?? 1;

  // 여러 payload 포맷 시도
  const variants: Record<
    number,
    { path: string; payload: unknown; method?: string }
  > = {
    1: {
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          board_no: boardNo,
          parent_article_no: articleNo,
          title: "RE: 답변",
          content,
          writer: "관리자",
        },
      },
    },
    2: {
      // 어드민 코멘트 엔드포인트 (password 필수)
      path: `/api/v2/admin/boards/${boardNo}/articles/${articleNo}/comments`,
      payload: {
        shop_no: 1,
        request: {
          content,
          writer: "관리자",
          password: "adminpass",
        },
      },
    },
    3: {
      // input_channel=A (admin)
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          board_no: boardNo,
          parent_article_no: articleNo,
          title: "RE: 답변",
          content,
          writer: "관리자",
          input_channel: "A",
        },
      },
    },
    4: {
      // 전용 reply 엔드포인트
      path: `/api/v2/admin/boards/${boardNo}/articles/${articleNo}/reply`,
      payload: {
        shop_no: 1,
        request: {
          content,
          writer: "관리자",
        },
      },
    },
    5: {
      // board_no 제거 (URL path에만)
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "관리자",
        },
      },
    },
    6: {
      // writer_id 추가
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "관리자",
          writer_id: "admin",
          writer_email: "plvekorea@gmail.com",
        },
      },
    },
    7: {
      // member_id + password
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "관리자",
          password: "paulvice1!",
          member_id: "admin",
        },
      },
    },
    8: {
      // 비회원 글쓰기 방식 (password 필수)
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "관리자",
          password: "paulvice1!",
        },
      },
    },
    9: {
      // is_new_article + admin input
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "관리자",
          password: "paulvice1!",
          input_channel: "A",
          secret: "F",
          display: "T",
        },
      },
    },
    10: {
      // 루트 article 생성 — parent 없이 기본 필드만
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          title: "테스트 글",
          content,
          writer: "관리자",
          password: "paulvice1!",
        },
      },
    },
    11: {
      // reply_depth 명시
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "관리자",
          password: "paulvice1!",
          reply_depth: 1,
          reply_sequence: 1,
        },
      },
    },
    12: {
      // PUT으로 원글에 admin reply 설정
      path: `/api/v2/admin/boards/${boardNo}/articles/${articleNo}`,
      method: "PUT",
      payload: {
        shop_no: 1,
        request: {
          reply: "T",
          reply_content: content,
        },
      },
    },
    13: {
      // 주문게시판(문의하기)용 answer 엔드포인트 후보
      path: `/api/v2/admin/boards/${boardNo}/articles/${articleNo}/answer`,
      payload: {
        shop_no: 1,
        request: {
          content,
          writer: "관리자",
        },
      },
    },
    14: {
      // 실제 답변글 516 구조를 완전 모방
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          board_no: boardNo,
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "한지형",
          writer_email: "@",
          member_id: "icaruse2000",
          reply_depth: 1,
          reply_sequence: 1,
          reply_mail: "Y",
          secret: "T",
        },
      },
    },
    15: {
      // 최소 필드 + member_id (mall_id)
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "한지형",
          writer_email: "@",
          member_id: "icaruse2000",
        },
      },
    },
    16: {
      // 14 - reply_sequence - reply_mail 제거 (9 필드)
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          board_no: boardNo,
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "한지형",
          writer_email: "@",
          member_id: "icaruse2000",
          reply_depth: 1,
          secret: "T",
        },
      },
    },
    17: {
      // requests 배열 (bulk 형식)
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        requests: [
          {
            parent_article_no: articleNo,
            title: "답변드립니다",
            content,
            writer: "한지형",
            writer_email: "@",
            member_id: "icaruse2000",
          },
        ],
      },
    },
    18: {
      // 7 필드 (최소화)
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        request: {
          parent_article_no: articleNo,
          title: "답변드립니다",
          content,
          writer: "한지형",
          member_id: "icaruse2000",
          secret: "T",
        },
      },
    },
    19: {
      // requests 배열 + client_ip + 실제 email
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        requests: [
          {
            parent_article_no: articleNo,
            title: "답변드립니다",
            content,
            writer: "한지형",
            writer_email: "plvekorea@gmail.com",
            member_id: "icaruse2000",
            client_ip: "127.0.0.1",
          },
        ],
      },
    },
    20: {
      // writer_email 생략
      path: `/api/v2/admin/boards/${boardNo}/articles`,
      payload: {
        shop_no: 1,
        requests: [
          {
            parent_article_no: articleNo,
            title: "답변드립니다",
            content,
            writer: "한지형",
            member_id: "icaruse2000",
            client_ip: "127.0.0.1",
          },
        ],
      },
    },
  };

  const chosen = variants[variant];
  if (!chosen) return Response.json({ error: "invalid variant" }, { status: 400 });

  try {
    const res = await fetch(`${BASE_URL}${chosen.path}`, {
      method: chosen.method ?? "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2026-03-01",
      },
      body: JSON.stringify(chosen.payload),
    });
    const text = await res.text();
    return Response.json({
      status: res.status,
      ok: res.ok,
      variant,
      path: chosen.path,
      payload: chosen.payload,
      response: text,
    });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cs/debug/cafe24
 * Cafe24 토큰 상태 + 게시판 목록 raw 응답 확인
 */
export async function GET() {
  const result: Record<string, unknown> = {};

  // 1. 토큰
  const accessToken = await getAccessTokenFromStore();
  result.hasToken = !!accessToken;
  if (!accessToken) {
    result.hint = "Supabase kv_store에 cafe24_refresh_token 없음 → 대시보드에서 Cafe24 로그인 필요";
    return Response.json(result);
  }
  result.tokenStart = accessToken.slice(0, 20) + "...";

  // 2. 게시판 목록 raw
  try {
    const boards = await cafe24Get(
      "/api/v2/admin/boards?limit=100",
      accessToken
    );
    result.boards = boards;
  } catch (e) {
    result.boardsError = e instanceof Error ? e.message : String(e);
  }

  // 3. 게시판 1개 직접 조회 (board_no=1은 대부분 공지사항)
  try {
    const articles = await cafe24Get(
      "/api/v2/admin/boards/4/articles?limit=5",
      accessToken
    );
    result.board4articles = articles;
  } catch (e) {
    result.board4error = e instanceof Error ? e.message : String(e);
  }

  return Response.json(result);
}
