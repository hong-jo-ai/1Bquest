/**
 * 모리 능동 발화 폴 엔드포인트.
 *
 * 클라이언트가 주기적으로 GET → 워커가 신호 감지·게이트(저렴) → 통과분만 멘트 생성·적재 →
 * 대기 중 능동 발화를 반환하고 큐를 비운다.
 *
 * 인증 게이트 뒤(proxy). 대부분의 폴링은 LLM 호출 없이 끝난다(신호 없거나 쿨다운).
 */

import { runPulse, drainQueue } from "@/lib/mori/pulse";
import { touchPresence } from "@/lib/mori/presence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    await touchPresence(); // 화면이 살아 있음을 기록 → cron이 자리비움 푸쉬를 안 함
    await runPulse(); // 신호 있으면 생성·적재(없으면 저렴하게 종료)
    const utterances = await drainQueue();
    return Response.json({ ok: true, utterances });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? "pulse 오류", utterances: [] });
  }
}
