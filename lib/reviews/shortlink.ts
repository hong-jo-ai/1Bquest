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
