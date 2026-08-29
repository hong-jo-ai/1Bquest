/**
 * 리뷰 토큰 짧은 링크 — 긴 base64url 토큰을 /r/<code> 짧은 코드로 매핑.
 * 문자(SMS)에 깔끔한 링크를 싣기 위함. 코드→토큰은 review_links 테이블 조회.
 */
import { reviewsDb } from "./core";
import crypto from "crypto";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 헷갈리는 문자(0,o,1,l) 제외
function genCode(len = 7): string {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** 토큰을 짧은 코드로 저장하고 코드 반환. 충돌 시 재시도. */
export async function createReviewShortLink(token: string, mall?: string, expiresAt?: Date): Promise<string> {
  const sb = reviewsDb();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genCode();
    const { error } = await sb.from("review_links").insert({
      code, token, mall: mall ?? null, expires_at: expiresAt ? expiresAt.toISOString() : null,
    });
    if (!error) return code;
    // 23505 = unique violation(코드 충돌) → 재시도. 그 외 에러는 throw.
    if (!String(error.code || error.message || "").includes("23505") && !/duplicate/i.test(error.message || "")) {
      throw new Error("short link 생성 실패: " + error.message);
    }
  }
  throw new Error("short link 코드 충돌 반복 — 재시도 실패");
}

/** 코드 → 토큰. 없거나 만료면 null. */
export async function resolveReviewCode(code: string): Promise<string | null> {
  const sb = reviewsDb();
  const { data } = await sb.from("review_links").select("token, expires_at").eq("code", code).maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.token as string;
}

/**
 * 링크 열람 기록. 첫 클릭 시각은 보존하고 횟수만 누적한다.
 *
 * 왜 세는가: 리뷰 전환율이 낮을 때 원인이 둘로 갈린다 —
 * ① 메시지를 안 열어본다(문안·발송타이밍 문제) ② 열었는데 안 쓴다(폼·보상 문제).
 * 클릭을 안 세면 이 둘을 구분할 수 없어서 어디를 고칠지 정하지 못한다.
 *
 * ⚠️ 실패해도 조용히 넘어간다. 집계 때문에 리뷰 페이지가 안 열리면 본말전도다.
 */
export async function recordReviewLinkClick(code: string): Promise<void> {
  try {
    const sb = reviewsDb();
    const { data } = await sb.from("review_links")
      .select("first_clicked_at, click_count").eq("code", code).maybeSingle();
    if (!data) return;
    const now = new Date().toISOString();
    await sb.from("review_links").update({
      first_clicked_at: (data as { first_clicked_at?: string }).first_clicked_at || now,
      last_clicked_at: now,
      click_count: ((data as { click_count?: number }).click_count ?? 0) + 1,
    }).eq("code", code);
  } catch { /* 집계 실패가 페이지를 막지 않는다 */ }
}
