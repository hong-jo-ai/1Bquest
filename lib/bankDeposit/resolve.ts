/**
 * 입금 SMS → 카페24 미결제 주문 매칭 + (HIGH 신뢰도면) 자동 입금확인.
 *
 * 웹훅(최초 1회)과 재시도 크론(bank-deposit-retry)이 공유하는 핵심 로직.
 * 입금 SMS엔 몰 정보가 없으므로 두 몰(폴바이스+해리엇)을 모두 조회한다.
 *
 * 자동 입금확인은 (두 몰 합쳐) 후보 정확히 1건 + 입금자명 일치(HIGH)일 때만.
 * 0건 / 복수 / 이름 미확인(MEDIUM)은 오확정 위험이 있어 알림만 하고 수동 처리.
 */
import { createHash } from "node:crypto";
import { type ParsedDeposit } from "./parser";
import { findDepositCandidates, type MatchCandidate } from "./matcher";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";

export const BRAND_KO: Record<MallId, string> = { paulvice: "폴바이스", harriot: "해리엇" };

/** HIGH 매칭 시 브라우저 입금확인 큐에 넣을 대상(API 입금확인은 422라 브라우저로 처리). */
export interface ConfirmTarget {
  orderId: string;
  mall:    MallId;
  amount:  number;
  name:    string | null;
}

export interface ResolveResult {
  candidates:    MatchCandidate[];
  /** 후보 1건 + 입금자명 일치(HIGH) → 브라우저 입금확인 대상. 아니면 null(수동/대기). */
  confirmTarget: ConfirmTarget | null;
  matchError:    string | null;
}

/** 입금 멱등키 — 은행+시각+금액+입금자. 같은 SMS 재전송/재시도 식별. */
export function depositHash(p: ParsedDeposit): string {
  const key = `${p.bank}|${p.occurredAt ?? ""}|${p.amount}|${p.depositorName ?? ""}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/** 두 몰 조회 → 매칭 → HIGH면 자동확정. 웹훅·크론 공용. */
export async function resolveDeposit(parsed: ParsedDeposit): Promise<ResolveResult> {
  const MALLS: MallId[] = ["paulvice", "harriot"];
  const tokens: Partial<Record<MallId, string>> = {};
  const candidates: MatchCandidate[] = [];
  const matchErrors: string[] = [];

  for (const mall of MALLS) {
    try {
      const tok = await getAccessTokenFromStore(mall);
      // 폴바이스 토큰 없으면 에러로 표기, 해리엇은 미연결일 수 있어 조용히 스킵.
      if (!tok) { if (mall === "paulvice") matchErrors.push("폴바이스 카페24 토큰 없음"); continue; }
      tokens[mall] = tok;
      candidates.push(...await findDepositCandidates(tok, parsed.amount, parsed.depositorName, mall));
    } catch (e) {
      matchErrors.push(`${BRAND_KO[mall]}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const matchError = matchErrors.length ? matchErrors.join(" / ") : null;

  // HIGH(후보 1건 + 입금자명 일치) → 브라우저 입금확인 대상. 실제 확정은 iMac 워처가 수행.
  let confirmTarget: ConfirmTarget | null = null;
  if (candidates.length === 1 && candidates[0].nameMatch && candidates[0].order.order_id) {
    const c = candidates[0];
    confirmTarget = { orderId: c.order.order_id as string, mall: c.mall, amount: c.amount, name: c.payerName ?? c.buyerName ?? null };
  }

  return { candidates, confirmTarget, matchError };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtKRW(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

export interface FormatOpts {
  /** 후보 0건일 때 "수동 확인" 대신 "재시도 대기중" 으로 표기 (최초 웹훅용). */
  pendingRetry?: boolean;
  /** head 뒤에 덧붙일 메모 (예: "재시도 매칭", "30분 경과"). */
  note?: string;
}

/** 매칭 결과 → 텔레그램 메시지. 웹훅·크론 공용. */
export function formatNotification(
  p: ParsedDeposit,
  candidates: MatchCandidate[],
  opts: FormatOpts = {},
): string {
  const head = [
    `💰 <b>${p.bank} 입금 ${escapeHtml(fmtKRW(p.amount))}</b>`,
    p.depositorName ? `· ${escapeHtml(p.depositorName)}` : "",
    opts.note ? `<i>(${escapeHtml(opts.note)})</i>` : "",
  ].filter(Boolean).join(" ");

  if (candidates.length === 0) {
    if (opts.pendingRetry) {
      return [
        head,
        `⏳ <b>주문 매칭 대기중</b> — 주문 등록 확인되면 자동 입금확인 (최대 30분 재시도)`,
        `<i>SMS: ${escapeHtml(p.raw.slice(0, 120))}</i>`,
      ].join("\n");
    }
    return [
      head,
      `❓ <b>매칭 주문 없음</b> — 카페24에서 수동 확인 필요`,
      `<i>SMS: ${escapeHtml(p.raw.slice(0, 120))}</i>`,
    ].join("\n");
  }

  if (candidates.length === 1) {
    const c = candidates[0];
    const o = c.order;
    const orderLine =
      `[${BRAND_KO[c.mall]}] 주문번호 <code>${escapeHtml(o.order_id ?? "?")}</code> · ${escapeHtml(c.buyerName || "?")}${c.payerName ? ` (입금자 ${escapeHtml(c.payerName)})` : ""}`;

    // HIGH(입금자명 일치) → 브라우저 자동 입금확인 예약(iMac 워처가 곧 처리, 결과는 별도 알림).
    if (c.nameMatch) {
      return [head, `🔄 <b>매칭 1건 — 자동 입금확인 예약됨</b> (곧 처리)`, orderLine].join("\n");
    }

    // MEDIUM(이름 미확인) — 알림만.
    return [
      head,
      `🟡 <b>MEDIUM</b> (이름 미확인) 매칭 1건`,
      orderLine,
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
      `• [${BRAND_KO[c.mall]}] <code>${escapeHtml(c.order.order_id ?? "?")}</code> · ${escapeHtml(c.buyerName || "?")}${c.payerName ? ` (${escapeHtml(c.payerName)})` : ""}${tag}`,
    );
  }
  if (candidates.length > 5) lines.push(`… 외 ${candidates.length - 5}건`);
  return lines.join("\n");
}
