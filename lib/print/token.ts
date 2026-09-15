/**
 * 윈도우 인쇄 에이전트 토큰 — 별도 env 없이 APP_AUTH_SECRET 에서 파생한다.
 * 노트북에는 이 값만 심는다(서비스 키·MCP 토큰을 노트북에 두지 않기 위해). 유출 시 APP_AUTH_SECRET 교체로 폐기.
 */
import crypto from "crypto";

export function printAgentToken(): string {
  const secret = process.env.APP_AUTH_SECRET || "";
  return crypto.createHmac("sha256", secret).update("print-agent-v1").digest("hex");
}

export function checkPrintAgent(req: Request): boolean {
  const t = req.headers.get("x-print-token") || new URL(req.url).searchParams.get("k") || "";
  const want = printAgentToken();
  if (!t || t.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want));
}
