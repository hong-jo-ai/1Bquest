/**
 * 채널 프로모션 제안 메일 자동 분석.
 *
 * plvekorea@gmail.com 받은편지함에는 각 판매 채널의 MD가 프로모션·기획전·입점·쿠폰·광고
 * 제안 메일을 보낸다(예: 29CM 남지수 MD, 카카오선물하기 김수환). 이 메일들을 읽고,
 * 폴바이스의 수익 구조·상황에 비춰 "참여할지/어떻게 할지"를 분석해 shong@ 로 제안 메일과
 * 텔레그램 알림을 보낸다.
 *
 * 1차: haiku 로 "프로모션 제안 메일인가" 저비용 분류
 * 2차: sonnet 으로 우리 상황 기반 심층 분석 + 추천
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { getKakaoGiftGmailAccessToken } from "@/lib/finance/kakaoGiftGmailToken";
import {
  fetchRecentInboxMessages,
  extractHeader,
  extractBody,
  parseFrom,
  isFromSelf,
} from "@/lib/cs/gmailClient";
import { getProfitSettings } from "@/lib/profitSettings";
import { sendTelegramMessage } from "@/lib/cs/telegram";

const SELF_EMAIL = "plvekorea@gmail.com";
const PROPOSAL_TO = process.env.PROMO_PROPOSAL_TO || "shong@harriotwatches.com";
const SEEN_KEY = "promo_analyze:seen";
const CLASSIFY_MODEL = "claude-haiku-4-5";
const ANALYZE_MODEL = process.env.PROMO_ANALYSIS_MODEL || "claude-sonnet-4-6";

const MAX_CLASSIFY_PER_RUN = 25;
const MAX_ANALYZE_PER_RUN = 8;
const SEEN_CAP = 600;

export interface PromoAnalysis {
  channel: string;
  counterparty: string;
  opportunity: string;
  pros: string[];
  cons: string[];
  marginNote: string;
  recommendation: "참여" | "조건부 참여" | "보류" | "거절";
  rationale: string;
  suggestedAction: string;
}

export interface PromoRunResult {
  ok: boolean;
  scanned: number;
  classified: number;
  promos: number;
  sent: number;
  skipped: string[];
  errors: string[];
}

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getSeenIds(): Promise<string[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from("kv_store").select("data").eq("key", SEEN_KEY).maybeSingle();
  const arr = data?.data;
  return Array.isArray(arr) ? (arr as string[]) : [];
}

async function saveSeenIds(ids: string[]): Promise<void> {
  const db = getDb();
  if (!db) return;
  const capped = ids.slice(-SEEN_CAP);
  await db.from("kv_store").upsert(
    { key: SEEN_KEY, data: capped, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
}

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function encodeMimeHeader(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf-8").toString("base64")}?=`;
}

/** 폴바이스 수익 구조 컨텍스트 — LLM 분석의 기준이 된다. */
async function buildBusinessContext(): Promise<string> {
  let feesLine = "";
  try {
    const settings = await getProfitSettings();
    const fees = Object.entries(settings.channelFees || {})
      .map(([k, v]) => `${k} ${v}%`)
      .join(", ");
    if (fees) feesLine = `채널 수수료(%): ${fees}\n`;
  } catch {
    // 설정 없으면 일반 가정으로 진행
  }
  return [
    "폴바이스(PLVE)는 여성 패션시계·주얼리 브랜드로, 오프라인 매장 없이 온라인으로만 판매하는 1인 기업입니다.",
    "운영 인력이 1명이라 운영 부담이 큰 행사는 실행 가능성을 함께 따져야 합니다.",
    feesLine +
      "대부분 채널 수수료가 25~33% 수준이라 추가 할인 폭은 마진을 빠르게 잠식합니다.",
    "카카오선물하기는 피오르드(대행)를 통하며 수수료 30% + 배송비/부자재를 모두 폴바이스가 부담합니다(순이익 ≈ 판매가×0.7 − 3,000원 − 원가).",
    "목표: 마진을 지키면서 노출·전환을 키워 매출을 늘리는 것. 마진을 심하게 해치는 제안은 보류/거절이 정답일 수 있습니다.",
  ].join("\n");
}

function toolInput<T>(resp: Anthropic.Messages.Message, name: string): T | null {
  const block = resp.content.find(
    (c): c is Anthropic.Messages.ToolUseBlock => c.type === "tool_use" && c.name === name,
  );
  return block ? (block.input as T) : null;
}

interface EmailDoc {
  id: string;
  threadId: string;
  from: string;
  fromName: string | null;
  fromEmail: string | null;
  subject: string;
  date: string;
  body: string;
}

async function classifyPromo(
  client: Anthropic,
  email: EmailDoc,
): Promise<{ isPromo: boolean; channel: string; counterparty: string }> {
  const resp = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 300,
    system:
      "너는 폴바이스(여성 시계·주얼리 온라인 브랜드)의 메일을 분류한다. " +
      "판매 채널(29CM, 무신사, W컨셉, 카카오선물하기, 식스샵 등)의 MD/담당자가 " +
      "프로모션·기획전·입점·쿠폰/할인 행사·광고/노출·캠페인 등 '매출을 늘릴 기회'를 제안하는 메일이면 isPromo=true. " +
      "단순 주문/발주서/정산/배송/시스템 알림/뉴스레터/광고메일은 false.",
    tools: [
      {
        name: "classify",
        description: "프로모션 제안 메일 분류",
        input_schema: {
          type: "object",
          properties: {
            isPromo: { type: "boolean" },
            channel: { type: "string", description: "채널명(모르면 빈 문자열)" },
            counterparty: { type: "string", description: "보낸 담당자/회사(모르면 빈 문자열)" },
          },
          required: ["isPromo", "channel", "counterparty"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify" },
    messages: [
      {
        role: "user",
        content:
          `보낸사람: ${email.from}\n제목: ${email.subject}\n날짜: ${email.date}\n\n${email.body.slice(0, 4000)}`,
      },
    ],
  });
  const out = toolInput<{ isPromo: boolean; channel: string; counterparty: string }>(resp, "classify");
  return {
    isPromo: !!out?.isPromo,
    channel: out?.channel || "",
    counterparty: out?.counterparty || "",
  };
}

async function analyzePromo(
  client: Anthropic,
  email: EmailDoc,
  context: string,
  hint: { channel: string; counterparty: string },
): Promise<PromoAnalysis | null> {
  const resp = await client.messages.create({
    model: ANALYZE_MODEL,
    max_tokens: 1500,
    system:
      "너는 폴바이스의 사업 파트너이자 냉정한 전략가다. 아래는 우리 회사 상황이다.\n\n" +
      context +
      "\n\n채널 MD가 보낸 프로모션 제안 메일을 읽고, '우리 상황에서 이걸 하는 게 최선인지' 판단하라. " +
      "수수료·원가·운영 부담·마진 잠식을 구체적으로 따지고, 매출을 늘릴 수 있는지 현실적으로 평가하라. " +
      "추천은 참여/조건부 참여/보류/거절 중 하나로 분명히 정하고, 구체적인 다음 행동(어떤 상품/할인폭/협상 포인트)을 제시하라. " +
      "한국어로, 사장님이 바로 판단할 수 있게 간결하고 실용적으로.",
    tools: [
      {
        name: "analyze",
        description: "프로모션 제안 분석 결과",
        input_schema: {
          type: "object",
          properties: {
            channel: { type: "string" },
            counterparty: { type: "string" },
            opportunity: { type: "string", description: "제안 핵심 한 줄 요약" },
            pros: { type: "array", items: { type: "string" } },
            cons: { type: "array", items: { type: "string" } },
            marginNote: { type: "string", description: "수수료/원가 고려한 수익성 코멘트" },
            recommendation: { type: "string", enum: ["참여", "조건부 참여", "보류", "거절"] },
            rationale: { type: "string", description: "우리 상황 기준 왜 이게 최선인가" },
            suggestedAction: { type: "string", description: "구체적 다음 행동" },
          },
          required: [
            "channel", "counterparty", "opportunity", "pros", "cons",
            "marginNote", "recommendation", "rationale", "suggestedAction",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "analyze" },
    messages: [
      {
        role: "user",
        content:
          `채널(추정): ${hint.channel}\n담당자(추정): ${hint.counterparty}\n` +
          `보낸사람: ${email.from}\n제목: ${email.subject}\n날짜: ${email.date}\n\n` +
          `=== 메일 본문 ===\n${email.body.slice(0, 6000)}`,
      },
    ],
  });
  return toolInput<PromoAnalysis>(resp, "analyze");
}

const REC_EMOJI: Record<string, string> = {
  "참여": "✅",
  "조건부 참여": "🟡",
  "보류": "⏸️",
  "거절": "🚫",
};

function buildProposalHtml(a: PromoAnalysis, email: EmailDoc): string {
  const li = (arr: string[]) =>
    (arr || []).map((x) => `<li style="margin:0 0 6px">${esc(x)}</li>`).join("") ||
    '<li style="color:#999">—</li>';
  const emoji = REC_EMOJI[a.recommendation] || "•";
  return `<div style="font-family:Arial,'Apple SD Gothic Neo',sans-serif;max-width:640px;margin:0 auto;color:#2b2620;line-height:1.6">
  <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a59c92;font-weight:700">PLVE · 프로모션 제안 분석</div>
  <h2 style="font-size:22px;margin:6px 0 2px">${esc(a.channel || "채널")} 제안 분석</h2>
  <div style="color:#8c8278;font-size:13px">${esc(a.counterparty || email.from)} · ${esc(email.subject)}</div>
  <div style="margin:18px 0;padding:16px 18px;background:#faf8f5;border:1px solid #ece7df;border-radius:14px">
    <div style="font-weight:700;margin-bottom:4px">제안 요약</div>
    <div>${esc(a.opportunity)}</div>
  </div>
  <div style="display:flex;gap:14px;flex-wrap:wrap">
    <div style="flex:1;min-width:240px;padding:14px 16px;border:1px solid #e7efe7;border-radius:12px;background:#f6faf6">
      <div style="font-weight:700;color:#3f7a52;margin-bottom:6px">장점</div>
      <ul style="margin:0;padding-left:18px;font-size:14px">${li(a.pros)}</ul>
    </div>
    <div style="flex:1;min-width:240px;padding:14px 16px;border:1px solid #f1e3e3;border-radius:12px;background:#fdf6f6">
      <div style="font-weight:700;color:#a85a5a;margin-bottom:6px">리스크 · 비용</div>
      <ul style="margin:0;padding-left:18px;font-size:14px">${li(a.cons)}</ul>
    </div>
  </div>
  <div style="margin:16px 0;padding:14px 16px;border:1px solid #ece7df;border-radius:12px">
    <div style="font-weight:700;margin-bottom:4px">수익성</div>
    <div style="font-size:14px">${esc(a.marginNote)}</div>
  </div>
  <div style="margin:18px 0;padding:18px;border-radius:14px;background:#2b2620;color:#fff">
    <div style="font-size:13px;color:#cfc7bb;letter-spacing:.08em">추천</div>
    <div style="font-size:20px;font-weight:800;margin:4px 0 8px">${emoji} ${esc(a.recommendation)}</div>
    <div style="font-size:14px;color:#eee">${esc(a.rationale)}</div>
  </div>
  <div style="margin:16px 0;padding:14px 16px;border:1px solid #ece7df;border-radius:12px;background:#faf8f5">
    <div style="font-weight:700;margin-bottom:4px">다음 행동</div>
    <div style="font-size:14px">${esc(a.suggestedAction)}</div>
  </div>
  <div style="margin-top:18px;font-size:12px;color:#a59c92">원본 메일: ${esc(email.from)} · ${esc(email.date)}<br>이 분석은 자동 생성된 참고 자료입니다.</div>
</div>`;
}

function buildTelegram(a: PromoAnalysis, email: EmailDoc): string {
  const emoji = REC_EMOJI[a.recommendation] || "•";
  return [
    `🎯 <b>프로모션 제안 — ${esc(a.channel || "채널")}</b>`,
    `${esc(a.counterparty || email.from)}`,
    "",
    esc(a.opportunity),
    "",
    `📌 추천: <b>${emoji} ${esc(a.recommendation)}</b>`,
    esc(a.rationale.slice(0, 400)),
    "",
    `👉 ${esc(a.suggestedAction.slice(0, 300))}`,
  ].join("\n");
}

async function sendProposalEmail(
  accessToken: string,
  subject: string,
  html: string,
): Promise<void> {
  const rfc822 =
    [
      `To: ${PROPOSAL_TO}`,
      `Subject: ${encodeMimeHeader(subject)}`,
      'Content-Type: text/html; charset="UTF-8"',
      "MIME-Version: 1.0",
    ].join("\r\n") +
    "\r\n\r\n" +
    html;
  const raw = Buffer.from(rfc822, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    throw new Error(`Gmail send 실패: ${res.status} ${await res.text()}`);
  }
}

export async function scanAndAnalyzePromoEmails(): Promise<PromoRunResult> {
  const result: PromoRunResult = {
    ok: true,
    scanned: 0,
    classified: 0,
    promos: 0,
    sent: 0,
    skipped: [],
    errors: [],
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...result, ok: false, errors: ["ANTHROPIC_API_KEY 미설정"] };
  }
  const accessToken = await getKakaoGiftGmailAccessToken();
  if (!accessToken) {
    return { ...result, ok: false, errors: ["plvekorea@ Gmail 토큰 없음 — 재인증 필요"] };
  }

  const messages = await fetchRecentInboxMessages(accessToken, {
    maxResults: 40,
    query: "in:inbox category:primary newer_than:10d",
  });
  result.scanned = messages.length;

  const seen = await getSeenIds();
  const seenSet = new Set(seen);
  const newSeen: string[] = [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const context = await buildBusinessContext();

  let classifiedCount = 0;
  let analyzedCount = 0;

  for (const msg of messages) {
    if (seenSet.has(msg.id)) continue;
    if (isFromSelf(msg, SELF_EMAIL)) {
      newSeen.push(msg.id);
      continue;
    }
    if (classifiedCount >= MAX_CLASSIFY_PER_RUN) break;

    const from = extractHeader(msg, "From") ?? "";
    const subject = extractHeader(msg, "Subject") ?? "(제목 없음)";
    const date = extractHeader(msg, "Date") ?? "";
    const { text } = extractBody(msg);
    const parsed = parseFrom(from);
    const email: EmailDoc = {
      id: msg.id,
      threadId: msg.threadId,
      from,
      fromName: parsed.name,
      fromEmail: parsed.email,
      subject,
      date,
      body: (text || msg.snippet || "").trim(),
    };

    try {
      classifiedCount += 1;
      const cls = await classifyPromo(client, email);
      result.classified += 1;
      newSeen.push(msg.id); // 분류했으면 재평가 방지

      if (!cls.isPromo) continue;
      result.promos += 1;
      if (analyzedCount >= MAX_ANALYZE_PER_RUN) {
        result.skipped.push(`analyze-cap:${subject.slice(0, 40)}`);
        continue;
      }
      analyzedCount += 1;

      const analysis = await analyzePromo(client, email, context, cls);
      if (!analysis) {
        result.errors.push(`분석 실패(빈 결과): ${subject.slice(0, 40)}`);
        continue;
      }

      const subjectLine = `[프로모션 제안] ${analysis.channel || cls.channel || "채널"} · 추천: ${analysis.recommendation}`;
      await sendProposalEmail(accessToken, subjectLine, buildProposalHtml(analysis, email));

      const tgButtons = [
        {
          text: "메일 열기",
          url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(SELF_EMAIL)}#all/${email.threadId}`,
        },
      ];
      await sendTelegramMessage(buildTelegram(analysis, email), { buttons: tgButtons });
      result.sent += 1;
    } catch (e) {
      result.errors.push(
        `${subject.slice(0, 40)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (newSeen.length) await saveSeenIds([...seen, ...newSeen]);
  result.ok = result.errors.length === 0;
  return result;
}
