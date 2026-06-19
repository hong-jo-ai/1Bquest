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
import { confirmOrderPayment, type ConfirmResult } from "./confirm";
import { getAccessTokenFromStore } from "@/lib/cafe24TokenStore";
import { type MallId } from "@/lib/cafe24Client";

export const BRAND_KO: Record<MallId, string> = { paulvice: "폴바이스", harriot: "해리엇" };

export interface ResolveResult {
  candidates: MatchCandidate[];
  confirm:    ConfirmResult | null;
  matchError: string | null;
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

  let confirm: ConfirmResult | null = null;
  if (candidates.length === 1 && candidates[0].nameMatch && candidates[0].order.order_id) {
    const c = candidates[0];
    const tok = tokens[c.mall];
    const orderId = c.order.order_id as string;
    if (tok) confirm = await confirmOrderPayment(tok, orderId, 1, c.mall);
  }

  return { candidates, confirm, matchError };
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
  confirm?: ConfirmResult | null,
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

    // 자동확정을 시도한 경우(HIGH) — 결과를 반영.
    if (confirm) {
      if (confirm.ok && confirm.alreadyConfirmed) {
        return [head, `✅ <b>이미 입금확인됨</b>`, orderLine].join("\n");
      }
      if (confirm.ok) {
        return [head, `✅ <b>자동 입금확인 완료</b> (상품준비중 전환)`, orderLine].join("\n");
      }
      return [
        head,
        `🟡 <b>매칭 1건 — 자동확정 실패, 수동 확인 필요</b>`,
        orderLine,
        `<i>사유: ${escapeHtml(confirm.error ?? "알 수 없음")}</i>`,
      ].join("\n");
    }

    // 자동확정 미시도(MEDIUM: 이름 미확인) — 알림만.
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
