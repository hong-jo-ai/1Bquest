/**
 * 로컬 에이전트(우체국 접수) 호출 헬퍼.
 * 접수는 보안키(SEED) + 계약 IP에서 실행돼야 하므로 항상 로컬 에이전트(7777) 경유.
 * (종추적조회는 공개 API라 서버리스에서 직접 — lib/postParcel/tracking.ts)
 */
const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:7777";

export interface AgentResult {
  success: boolean;
  regiNo?: string;
  regipoNm?: string;
  price?: string;
  skipped?: boolean;
  test?: boolean;
  error?: string;
  code?: string;
  [k: string]: unknown;
}

export async function callAgent(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = 120000
): Promise<AgentResult> {
  const res = await fetch(`${AGENT_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return (await res.json()) as AgentResult;
}

/** 단발 접수 (인플루언서·AS·수동 등) */
export function registerOne(order: Record<string, unknown>, source: string, reqType: "1" | "2" = "1") {
  return callAgent("/postparcel/register-one", { ...order, source, reqType });
}
