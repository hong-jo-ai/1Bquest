/**
 * 앱 자체 로그인 세션 토큰 — Web Crypto HMAC-SHA256.
 * Edge runtime (middleware) 와 Node runtime (route handler) 양쪽에서 동작.
 *
 * 토큰 포맷: base64url(JSON.stringify(payload)) + "." + base64url(HMAC)
 * payload: { email: string, exp: number /* unix sec *\/ }
 *
 * 인증 정책:
 *   - Google OAuth로 이메일 검증 → 화이트리스트(env: APP_AUTH_ALLOWED_EMAIL) 일치 시 발급
 *   - 90일 유효
 *   - HMAC 서명으로 위변조 방지
 */

const ALG = { name: "HMAC", hash: "SHA-256" } as const;
const enc = new TextEncoder();

export const SESSION_COOKIE = "paulwise_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 90; // 90일

export interface SessionPayload {
  email: string;
  exp: number; // unix seconds
}

function b64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const fill = (4 - (padded.length % 4)) % 4;
  const decoded = atob(padded + "=".repeat(fill));
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), ALG, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  const data = b64UrlEncode(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(ALG, key, enc.encode(data));
  return `${data}.${b64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sigB64] = parts;
  const key = await importKey(secret);
  // ArrayBuffer로 복사 (TS 엄격 모드에서 SharedArrayBuffer 가능성 회피)
  const sigBytes = b64UrlDecode(sigB64);
  const sigBuf = sigBytes.buffer.slice(
    sigBytes.byteOffset,
    sigBytes.byteOffset + sigBytes.byteLength,
  ) as ArrayBuffer;
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(ALG, key, sigBuf, enc.encode(data));
  } catch {
    return null;
  }
  if (!valid) return null;

  let decoded: SessionPayload;
  try {
    const json = new TextDecoder().decode(b64UrlDecode(data));
    decoded = JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
  if (
    typeof decoded.email !== "string" ||
    typeof decoded.exp !== "number" ||
    decoded.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return decoded;
}

export function isEmailAllowed(email: string): boolean {
  const allowed = (process.env.APP_AUTH_ALLOWED_EMAIL || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
