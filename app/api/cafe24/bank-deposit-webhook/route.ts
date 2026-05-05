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
 *   - 0건: ❓ 미매칭 입금 — 수동 확인 필요
 *   - 1건 (이름 일치): ✅ 매칭 1건 (HIGH 신뢰도) — 카페24에서 확정
 *   - 1건 (이름 불일치): 🟡 1건 후보 (MEDIUM 신뢰도)
 *   - 다수: ⚠ 같은 금액 N건 — 입금자 확인 후 수동 매칭
 *
 * idempotency: SMS 의 핵심 정보(은행+시각+금액+입금자) 해시를 kv_store 에 기록.
 * 같은 SMS 가 재전송돼도 텔레그램 중복 발송 안 함.
 */
import { createHash } from "node:crypto";
import { type NextRequest } from "next/server";
import { parseBankSms, type ParsedDeposit } from "@/lib/bankDeposit/parser";
import { findDepositCandidates, type MatchCandidate } from "@/lib/bankDeposit/matcher";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { getCsSupabase } from "@/lib/cs/store";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";

export const dynamic    = "force-dynamic";
export const maxDuration = 30;

const KV_PREFIX = "bank_deposit_processed:";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtKRW(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

function depositHash(p: ParsedDeposit): string {
  const key = `${p.bank}|${p.occurredAt ?? ""}|${p.amount}|${p.depositorName ?? ""}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

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

function formatNotification(p: ParsedDeposit, candidates: MatchCandidate[]): string {
  const head = [
    `💰 <b>${p.bank} 입금 ${escapeHtml(fmtKRW(p.amount))}</b>`,
    p.depositorName ? `· ${escapeHtml(p.depositorName)}` : "",
  ].filter(Boolean).join(" ");

  if (candidates.length === 0) {
    return [
      head,
      `❓ <b>매칭 주문 없음</b> — 카페24에서 수동 확인 필요`,
      `<i>SMS: ${escapeHtml(p.raw.slice(0, 120))}</i>`,
    ].join("\n");
  }

  if (candidates.length === 1) {
    const c = candidates[0];
    const o = c.order;
    const confidence = c.nameMatch ? "✅ <b>HIGH</b>" : "🟡 <b>MEDIUM</b> (이름 미확인)";
    return [
      head,
      `${confidence} 매칭 1건`,
      `주문번호 <code>${escapeHtml(o.order_id ?? "?")}</code> · ${escapeHtml(c.buyerName || "?")}${c.payerName ? ` (입금자 ${escapeHtml(c.payerName)})` : ""}`,
      `카페24 어드민에서 입금확정해주세요.`,
    ].join("\n");
  }

  // 다수 후보
  const lines = [
    head,
    `⚠ <b>같은 금액 ${candidates.length}건</b> — 입금자명 확인 후 수동 매칭`,
  ];
  for (const c of candidates.slice(0, 5)) {
    const tag = c.nameMatch ? " ⭐" : "";
    lines.push(
      `• <code>${escapeHtml(c.order.order_id ?? "?")}</code> · ${escapeHtml(c.buyerName || "?")}${c.payerName ? ` (${escapeHtml(c.payerName)})` : ""}${tag}`,
    );
  }
  if (candidates.length > 5) lines.push(`… 외 ${candidates.length - 5}건`);
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const expected = process.env.BANK_DEPOSIT_WEBHOOK_SECRET;
  if (!expected) {
    return Response.json(
      { ok: false, error: "BANK_DEPOSIT_WEBHOOK_SECRET 미설정" },
      { status: 503 },
    );
  }
  const tok =
    req.nextUrl.searchParams.get("token") ?? req.headers.get("x-auth-token");
  if (tok !== expected) {
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

  // 카페24 미결제 주문 매칭
  let candidates: MatchCandidate[] = [];
  let matchError: string | null = null;
  try {
    const cafeToken = await getAccessTokenFromStore();
    if (cafeToken) {
      candidates = await findDepositCandidates(cafeToken, parsed.amount, parsed.depositorName);
    } else {
      matchError = "카페24 토큰 없음";
    }
  } catch (e) {
    matchError = e instanceof Error ? e.message : String(e);
  }

  // 텔레그램 발송 (매칭 실패해도 입금 자체는 알림)
  let telegramText = formatNotification(parsed, candidates);
  if (matchError) {
    telegramText += `\n<i>⚠ 매칭 조회 실패: ${escapeHtml(matchError)}</i>`;
  }
  await sendTelegramMessage(telegramText);

  await markProcessed(hash, {
    parsed,
    candidates: candidates.length,
    ts: new Date().toISOString(),
  });

  return Response.json({
    ok: true,
    parsed,
    matched: candidates.length,
    matchError: matchError ?? undefined,
  });
}
