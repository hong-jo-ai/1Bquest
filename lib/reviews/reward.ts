/**
 * 리뷰 보상(적립금) 지급 — 우리 시스템에서 받은 리뷰를 카페24 회원에게 적립금으로 환원.
 *
 * 흐름: reviews.reward_status='pending' 인 행 → 전화번호(우선)/이메일로 카페24 회원 매칭
 *      → 적립금 지급(POST /admin/points) → reward_status='paid' 기록.
 *      비회원이면 'skipped'(주문은 했지만 카페24 회원이 아님 — 글로벌·게스트).
 *
 * 사진/동영상 차등 보상은 reviews.reward_points 에 이미 계산돼 있다(rewardFor).
 * 카페24 게시판 자체 적립은 차등이 안 되므로, 지급은 전적으로 이 모듈이 담당한다.
 *
 * ⚠️ 필요 스코프: mall.read_customer, mall.write_mileage (카페24 재연결로 부여).
 */
import { reviewsDb, getMall, type MallId } from "./core";
import { cafe24Get, cafe24Post, type MallId as Cafe24Mall } from "@/lib/cafe24Client";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

function digits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

/** 카페24 회원 조회 — 휴대폰 번호로(국내 회원은 cellphone 등록). 매칭되면 member_id 반환. */
export async function findMemberIdByPhone(
  cafe24Mall: Cafe24Mall,
  shopNo: number,
  phone: string,
  at: string,
): Promise<string | null> {
  const cell = digits(phone);
  if (cell.length < 9) return null;
  // 카페24 customers 는 cellphone 정확매칭. 하이픈 유무 모두 시도.
  const variants = [cell, `${cell.slice(0, 3)}-${cell.slice(3, cell.length - 4)}-${cell.slice(-4)}`];
  for (const v of variants) {
    try {
      const res = await cafe24Get(
        `/api/v2/admin/customers?shop_no=${shopNo}&cellphone=${encodeURIComponent(v)}&limit=1`,
        at,
        cafe24Mall,
      );
      const m = res?.customers?.[0];
      if (m?.member_id) return m.member_id as string;
    } catch {
      /* 다음 변형 시도 */
    }
  }
  return null;
}

export interface RewardResult {
  status: "paid" | "skipped" | "failed";
  memberId?: string;
  points?: number;
  note?: string;
}

/** 적립금 지급 1건. 회원 매칭 → POST points. (멱등성은 호출부에서 reward_status 로 보장) */
export async function issueReward(args: {
  mall: MallId;
  phone?: string | null;
  points: number;
  productName?: string | null;
}): Promise<RewardResult> {
  const mall = getMall(args.mall);
  if (!mall) return { status: "failed", note: "unknown mall" };
  if (!args.points || args.points <= 0) return { status: "skipped", note: "보상 0원" };

  const at = await getAccessTokenFromStore(mall.cafe24Mall);
  if (!at) return { status: "failed", note: "cafe24 토큰 없음" };

  // 1) 회원 매칭 — 전화번호 기준(국내). 비회원/게스트면 skip.
  if (!args.phone) return { status: "skipped", note: "전화번호 없음(회원매칭 불가)" };
  const memberId = await findMemberIdByPhone(mall.cafe24Mall, mall.shopNo, args.phone, at);
  if (!memberId) return { status: "skipped", note: "카페24 회원 아님(전화 미매칭)" };

  // 2) 적립금 지급 — POST /api/v2/admin/points (검증완료 2026-06-25, 201).
  //    스코프 mall.write_mileage 필요("특정 클라이언트만" → 개발자센터 승인). 공지의 /mileage URL은 404, /points가 실제 엔드포인트.
  //    엔드포인트는 env(REVIEW_MILEAGE_PATH)로 덮어쓰기 가능.
  const path = process.env.REVIEW_MILEAGE_PATH || "/api/v2/admin/points";
  const reason = `리뷰 작성 감사 적립${args.productName ? ` — ${args.productName}` : ""}`;
  try {
    const res = await cafe24Post(
      path,
      at,
      {
        shop_no: mall.shopNo,
        request: {
          member_id: memberId,
          amount: String(args.points),
          type: "increase",   // 지급(증가). 차감은 decrease
          reason,
        },
      },
      mall.cafe24Mall,
    );
    const ok = res?.mileage || res?.point || res?.points || res?.request;
    if (ok) return { status: "paid", memberId, points: args.points };
    return { status: "failed", memberId, note: "지급 응답 비정상: " + JSON.stringify(res).slice(0, 200) };
  } catch (e) {
    return { status: "failed", memberId, note: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}

/** pending 리뷰 일괄 지급. 관리자/크론에서 호출. 멱등(처리한 건 reward_status 갱신). */
export async function payPendingRewards(mall: MallId, limit = 50): Promise<{
  processed: number; paid: number; skipped: number; failed: number;
  details: Array<{ id: string; status: string; points?: number; note?: string }>;
}> {
  const sb = reviewsDb();
  const { data: rows } = await sb
    .from("reviews")
    .select("id, mall, customer_phone, reward_points, product_name, status")
    .eq("mall", mall)
    .eq("reward_status", "pending")
    .eq("status", "published") // 숨김/스팸은 보상 제외
    .gt("reward_points", 0)
    .limit(limit);

  const details: Array<{ id: string; status: string; points?: number; note?: string }> = [];
  let paid = 0, skipped = 0, failed = 0;
  for (const r of rows || []) {
    const res = await issueReward({
      mall: r.mall as MallId,
      phone: r.customer_phone,
      points: r.reward_points,
      productName: r.product_name,
    });
    await sb.from("reviews").update({
      reward_status: res.status,
      reward_member_id: res.memberId ?? null,
      reward_paid_points: res.status === "paid" ? res.points ?? null : null,
      reward_paid_at: res.status === "paid" ? new Date().toISOString() : null,
      reward_note: res.note ?? null,
    }).eq("id", r.id);
    if (res.status === "paid") paid++;
    else if (res.status === "skipped") skipped++;
    else failed++;
    details.push({ id: r.id, status: res.status, points: res.points, note: res.note });
  }
  return { processed: (rows || []).length, paid, skipped, failed, details };
}
