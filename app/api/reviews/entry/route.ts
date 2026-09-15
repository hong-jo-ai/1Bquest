import { type NextRequest } from "next/server";
import { issueEntryToken } from "@/lib/reviews/entry";
import { getMall } from "@/lib/reviews/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reviews/entry  { mall, productNo, phone? | email?, skip? }
 * 상품페이지 "리뷰 작성하기" → 연락처로 주문을 찾아 리뷰 토큰을 만든다(익명 공개).
 * 응답은 토큰 URL 뿐 — 주문 내용·이름은 돌려주지 않는다(연락처만 아는 사람에게 구매 사실을 확인시켜 주지 않기 위해;
 * 폼에 미리 채우는 이름도 가린 값이다).
 */
export async function POST(req: NextRequest) {
  let body: { mall?: string; productNo?: number | string; phone?: string; email?: string; skip?: boolean };
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const mall = getMall(String(body.mall ?? ""));
  const productNo = Number(body.productNo);
  if (!mall || !Number.isFinite(productNo) || productNo <= 0) {
    return Response.json({ error: "mall / productNo 가 올바르지 않습니다" }, { status: 400 });
  }
  const phone = String(body.phone ?? "").replace(/\D/g, "").slice(0, 15);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 120);
  if (!body.skip && phone.length < 10 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: mall.currency === "KRW" ? "휴대폰 번호를 확인해 주세요" : "Please enter a valid email" }, { status: 400 });
  }

  const res = await issueEntryToken(mall.id, productNo, body.skip ? {} : { phone, email });
  if (!res) return Response.json({ error: "발급 실패" }, { status: 500 });
  return Response.json({ ok: true, url: `/review/${res.token}`, verified: res.verified });
}
