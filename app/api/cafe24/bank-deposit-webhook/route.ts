/**
 * iPhone 단축어로부터 KB/우리은행 입금 SMS를 받아 카페24 미결제 무통장 주문과
 * 매칭, 텔레그램으로 알림 발송.
 *
 * 인증: ?token=<BANK_DEPOSIT_WEBHOOK_SECRET>
 *
 * Body (JSON):
 *   { "sender": "KB" | "우리" | "<발신번호>", "body": "<SMS 본문>" }
 *
 * 응답: { ok, parsed?, matched: number, duplicate?: true }
 *
 * 매칭 결과 별 텔레그램 메시지:
 *   - 0건: ⏳ 주문 매칭 대기중 — 재시도 큐 적재(bank-deposit-retry 크론이 최대 30분 재매칭)
 *   - 1건 (이름 일치): ✅ 매칭 1건 (HIGH 신뢰도) — 카페24에서 확정
 *   - 1건 (이름 불일치): 🟡 1건 후보 (MEDIUM 신뢰도)
 *   - 다수: ⚠ 같은 금액 N건 — 입금자 확인 후 수동 매칭
 *
 * 타이밍 역전(입금 SMS가 주문 등록보다 먼저 도착)이면 최초 0건이 되므로,
 * 즉시 수동확인으로 버리지 않고 재시도 큐에 넣어 크론이 따라잡게 한다.
 *
 * idempotency: SMS 의 핵심 정보(은행+시각+금액+입금자) 해시를 kv_store 에 기록.
 * 같은 SMS 가 재전송돼도 텔레그램 중복 발송 안 함.
 */
import { type NextRequest } from "next/server";
import { parseBankSms } from "@/lib/bankDeposit/parser";
import { resolveDeposit, depositHash, formatNotification } from "@/lib/bankDeposit/resolve";
import { enqueuePending } from "@/lib/bankDeposit/pending";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { getCsSupabase } from "@/lib/cs/store";

export const dynamic    = "force-dynamic";
export const maxDuration = 30;

const KV_PREFIX = "bank_deposit_processed:";

async function isAlreadyProcessed(hash: string): Promise<boolean> {
  const db = getCsSupabase();
  const { data } = await db
    .from("kv_store")
    .select("data")
    .eq("key", `${KV_PREFIX}${hash}`)
    .maybeSingle();
  return !!data;
}

async function markProcessed(hash: string, payload: unknown): Promise<void> {
  const db = getCsSupabase();
  await db.from("kv_store").upsert(
    {
      key: `${KV_PREFIX}${hash}`,
      data: payload as object,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

export async function POST(req: NextRequest) {
  // 인증: (a) iPhone 단축어 — ?token=/x-auth-token=BANK_DEPOSIT_WEBHOOK_SECRET,
  //       (b) iMac 로컬 에이전트 — x-agent-token=PAULWISE_MCP_TOKEN.
  const webhookSecret = process.env.BANK_DEPOSIT_WEBHOOK_SECRET;
  const agentToken = process.env.PAULWISE_MCP_TOKEN;
  if (!webhookSecret && !agentToken) {
    return Response.json(
      { ok: false, error: "BANK_DEPOSIT_WEBHOOK_SECRET / PAULWISE_MCP_TOKEN 모두 미설정" },
      { status: 503 },
    );
  }
  const shortcutTok =
    req.nextUrl.searchParams.get("token") ?? req.headers.get("x-auth-token");
  const agentTok = req.headers.get("x-agent-token");
  const authed =
    (!!webhookSecret && shortcutTok === webhookSecret) ||
    (!!agentToken && agentTok === agentToken);
  if (!authed) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let payload: { sender?: string; body?: string };
  try {
    payload = (await req.json()) as { sender?: string; body?: string };
  } catch {
    // 단축어가 text/plain 으로 보낼 수도 있음
    const text = await req.text();
    payload = { body: text };
  }
  const body = payload.body?.trim() ?? "";
  if (!body) {
    return Response.json({ ok: false, error: "body required" }, { status: 400 });
  }

  const parsed = parseBankSms(body, payload.sender);
  if (!parsed) {
    // 입금 SMS 가 아닌 다른 SMS 도 단축어가 보낼 수 있음 — silently OK
    return Response.json({ ok: true, skipped: "not a deposit SMS", raw: body.slice(0, 200) });
  }

  const hash = depositHash(parsed);
  if (await isAlreadyProcessed(hash)) {
    return Response.json({ ok: true, duplicate: true });
  }

  // 카페24 미결제 주문 매칭 + (HIGH면) 자동 입금확인 — 두 몰 조회.
  const { candidates, confirm, matchError } = await resolveDeposit(parsed);

  // 타이밍 역전 방어: 후보 0건이면 주문이 아직 등록 안 됐을 수 있다(입금 SMS 선도착).
  // 즉시 "수동 확인" 으로 버리지 말고 재시도 큐에 적재 → bank-deposit-retry 크론이 따라잡는다.
  // (매칭 조회 자체가 실패한 경우는 제외 — 토큰/네트워크 문제라 재시도 큐 대상 아님.)
  const queuedForRetry = candidates.length === 0 && !matchError;
  if (queuedForRetry) {
    await enqueuePending(hash, parsed);
  }

  // 텔레그램 발송 (매칭 실패해도 입금 자체는 알림)
  let telegramText = formatNotification(parsed, candidates, confirm, { pendingRetry: queuedForRetry });
  if (matchError) {
    telegramText += `\n<i>⚠ 매칭 조회 실패: ${matchError.replace(/</g, "&lt;")}</i>`;
  }
  await sendTelegramMessage(telegramText);

  await markProcessed(hash, {
    parsed,
    candidates: candidates.length,
    confirmed: confirm?.ok ? confirm.confirmed : 0,
    ts: new Date().toISOString(),
  });

  return Response.json({
    ok: true,
    parsed,
    matched: candidates.length,
    confirmed: confirm?.ok ? confirm.confirmed : 0,
    confirmError: confirm && !confirm.ok ? confirm.error : undefined,
    matchError: matchError ?? undefined,
  });
}
