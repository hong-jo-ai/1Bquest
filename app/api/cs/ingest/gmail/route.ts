import { syncAllGmailAccounts } from "@/lib/cs/gmailIngest";
import { syncHarriotWebform } from "@/lib/cs/harriotWebform";

// ⚠️ 60초였는데, 분류가 실제로 동작하기 시작하자(2026-09-03 Haiku 전환) 타임아웃이 났다.
// 예전엔 429 로 즉시 실패해서 빨랐던 것이지 일이 적었던 게 아니다.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function run() {
  try {
    const result = await syncAllGmailAccounts();
    // 해리엇 홈페이지 문의폼(info@ 로 오는, CS 계정에 없는 메일함) 전용 수집.
    // 격리: 실패해도 기존 CS 동기화 결과는 정상 반환.
    let webform: unknown;
    try {
      webform = await syncHarriotWebform();
    } catch (e) {
      webform = { error: e instanceof Error ? e.message : String(e) };
    }
    return Response.json({ ok: true, ...result, webform });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

// GET: Vercel Cron 호출용 — CRON_SECRET 검증
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  return run();
}

// POST: UI 수동 트리거용 — 인증 없이 허용 (앱 내부에서만 호출)
export async function POST() {
  return run();
}
