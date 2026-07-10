/**
 * 답장 필요 인박스 — Gmail 페치 + Claude 자동 분류 + 사용자 피드백 학습.
 *
 * 흐름:
 *  1. shong@harriotwatches.com 인박스에서 최근 14일 메일 list
 *  2. 이미 분류된(messageId 캐시 존재) + 자동 SENT 처리된 건 제외
 *  3. 남은 신규 메일에 대해 Claude (haiku) 로 needsReply 분류 (negative examples 프롬프트 캐싱 활용)
 *  4. 결과를 kv_store 에 저장
 *  5. 각 분류된 메일의 스레드에 SENT 메시지 있으면 userReplied=true 자동 마킹
 */
import Anthropic from "@anthropic-ai/sdk";
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";
import { sendTelegramMessage } from "@/lib/cs/telegram";
import { isWebformEmail } from "@/lib/cs/harriotWebform";
import {
  saveClassifiedEmail, getClassifiedEmail, patchClassifiedEmail,
  listNegativeExamples,
  type ClassifiedEmail, type NegativeExample, type InboxSyncStatus,
} from "./inboxStore";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatEmailNotification(email: ClassifiedEmail): string {
  const sender = email.fromName
    ? `${email.fromName} <${email.fromEmail}>`
    : email.fromEmail;
  const link = `https://mail.google.com/mail/u/0/#inbox/${email.threadId}`;
  return [
    `📧 <b>답장 필요 메일</b>`,
    `<b>${escapeHtml(sender)}</b>`,
    escapeHtml(email.subject),
    email.snippet ? escapeHtml(email.snippet.slice(0, 200)) : "",
    email.reason ? `<i>판단: ${escapeHtml(email.reason)}</i>` : "",
    `<a href="${link}">Gmail에서 열기</a>`,
  ]
    .filter(Boolean)
    .join("\n");
}

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const CLAUDE_MODEL = "claude-haiku-4-5";

interface RawHeader { name: string; value: string }
interface RawMessage {
  id:           string;
  threadId:     string;
  internalDate: string;
  snippet?:     string;
  labelIds?:    string[];
  payload?: { headers?: RawHeader[] };
}

async function gmailFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 && /insufficient|ACCESS_TOKEN_SCOPE/i.test(body)) {
      throw new Error(
        "Gmail 스코프 부족 (gmail.modify). " +
        "/api/auth/google/login?hint=shong@harriotwatches.com 으로 재연결 필요.",
      );
    }
    throw new Error(`Gmail ${path}: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

function header(msg: RawMessage, name: string): string {
  return (msg.payload?.headers ?? [])
    .find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseFrom(raw: string): { name: string | null; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim() };
  if (raw.includes("@")) return { name: null, email: raw.trim() };
  return { name: raw.trim(), email: "" };
}

/** 인박스 메일 메타데이터만 빠르게 list (분류 후보) */
async function listInboxMetadata(token: string, daysBack: number): Promise<RawMessage[]> {
  const q = `in:inbox newer_than:${daysBack}d`;
  const list = await gmailFetch<{ messages?: Array<{ id: string }> }>(
    token,
    `/messages?q=${encodeURIComponent(q)}&maxResults=200`,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: RawMessage[] = [];
  // 병렬 처리 (10 개씩)
  const BATCH = 10;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const res = await Promise.all(slice.map(async (id) => {
      try {
        return await gmailFetch<RawMessage>(
          token,
          `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        );
      } catch {
        return null;
      }
    }));
    for (const r of res) if (r) out.push(r);
  }
  return out;
}

/** 스레드에 자기 자신이 보낸 SENT 메시지가 있는지 확인 — userReplied 자동 감지 */
async function hasSentInThread(token: string, threadId: string, afterTs: number): Promise<boolean> {
  try {
    const t = await gmailFetch<{ messages?: Array<{ labelIds?: string[]; internalDate?: string }> }>(
      token,
      `/threads/${threadId}?format=minimal`,
    );
    return (t.messages ?? []).some((m) =>
      (m.labelIds ?? []).includes("SENT") &&
      parseInt(m.internalDate ?? "0", 10) > afterTs
    );
  } catch {
    return false;
  }
}

// ── Claude 분류 ────────────────────────────────────────────────────────────

interface ClassificationOutput {
  needsReply: boolean;
  reason:     string;
  confidence: number;
}

function buildSystemPrompt(negatives: NegativeExample[]): string {
  const lines = [
    "역할: 1인 크리에이터(폴바이스/해리엇 시계 브랜드 운영, 대표 홍성조)의 비즈니스 이메일을 분류.",
    "",
    "needsReply=true 로 분류:",
    "- 비즈니스 거래/협업 (입점 제안, MD/PD 미팅, 리테일 파트너 요청)",
    "- 고객 문의/요청 (주문 변경, 환불, 상품/AS 문의, 응대 필요 클레임)",
    "- 거래처 의사결정 요청 (디자이너·제조사·배송 업체에서 답변 기다림)",
    "- 인플루언서 협업 제안 (DM/메일로 문의 들어온 경우)",
    "- 정부/행정 안내 중 회신 필요한 건 (세금·인증·보험 등)",
    "",
    "needsReply=false 로 분류:",
    "- 자동화 알림 (주문 발생/결제/배송 알림 등 시스템 메일)",
    "- 마케팅/뉴스레터/프로모션",
    "- 영수증·세금계산서 발급 알림 (행동 필요 없음)",
    "- 단순 정보 공유 (FYI, 공지)",
    "- 광고/스팸",
    "- 본인이 보낸 메일에 자동 회신",
    "",
    "응답: 반드시 다음 JSON 형식만 (코드블록/설명 없이):",
    `{"needsReply": true|false, "reason": "한 줄 한국어", "confidence": 0.0~1.0}`,
  ];
  if (negatives.length > 0) {
    lines.push("");
    lines.push("사용자가 과거 '필요없음' 으로 거른 사례 — 비슷한 메일은 needsReply=false 로 강한 경향:");
    for (const ne of negatives.slice(-50)) {
      lines.push(`- 발신: ${ne.fromEmail} / 제목 예시: "${ne.subjectSample}" (사유: ${ne.reason})`);
    }
  }
  return lines.join("\n");
}

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수 누락");
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/** Anthropic API 의 치명적(전체 sync 중단해야 하는) 에러 — 잔액/자격증명 등 */
function isFatalAnthropicError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    /credit balance/i.test(msg) ||
    /invalid api key/i.test(msg) ||
    /authentication_error/i.test(msg) ||
    /api key not found/i.test(msg) ||
    /401/.test(msg) ||
    /402/.test(msg) ||
    /403/.test(msg) ||
    /quota/i.test(msg)
  );
}

async function classifyOne(
  client: Anthropic,
  systemPrompt: string,
  email: { fromEmail: string; fromName: string | null; subject: string; snippet: string; receivedAt: string },
): Promise<ClassificationOutput> {
  const userMsg = [
    `발신자: ${email.fromName ?? ""} <${email.fromEmail}>`,
    `수신일: ${email.receivedAt}`,
    `제목: ${email.subject}`,
    `미리보기: ${email.snippet || "(없음)"}`,
  ].join("\n");

  const res = await client.messages.create({
    model:       CLAUDE_MODEL,
    max_tokens:  200,
    system: [
      {
        type:           "text",
        text:           systemPrompt,
        cache_control:  { type: "ephemeral" }, // 분류 배치 동안 시스템 프롬프트 캐싱
      },
    ],
    messages: [{ role: "user", content: userMsg }],
  });

  const text = res.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Claude 응답에서 JSON 추출 실패: ${text.slice(0, 200)}`);
  const json = JSON.parse(m[0]) as ClassificationOutput;
  return {
    needsReply: !!json.needsReply,
    reason:     String(json.reason ?? "").slice(0, 200),
    confidence: typeof json.confidence === "number" ? Math.max(0, Math.min(1, json.confidence)) : 0.5,
  };
}

// ── 메인 sync ──────────────────────────────────────────────────────────────

export async function syncInbox(): Promise<InboxSyncStatus> {
  const token = await getGoogleAccessTokenFromStore();
  if (!token) {
    throw new Error("Google 미연결 — /api/auth/google/login 으로 OAuth 후 재시도");
  }

  const messages = await listInboxMetadata(token, 14);
  const negatives = await listNegativeExamples();
  const systemPrompt = buildSystemPrompt(negatives);
  const client = getClient();

  // 1회 sync 당 최대치 — Vercel 60초 제한 대비. 나머지는 다음 sync(매시) 에 처리.
  const MAX_NEW_PER_SYNC = 50;
  const PARALLEL          = 5;

  let newClassified = 0;
  let pendingCount  = 0;
  const errors: Array<{ messageId: string; error: string }> = [];
  let fatalError: string | null = null;

  // Phase 1: 분류 안 된 신규 / 이미 분류된 needsReply 케이스 분리
  type PendingMsg = { msg: typeof messages[number] };
  const toClassify: PendingMsg[] = [];
  const toCheckSent: typeof messages = [];

  for (const msg of messages) {
    if ((msg.labelIds ?? []).includes("SENT")) continue;
    const existing = await getClassifiedEmail(msg.id);
    if (!existing) {
      toClassify.push({ msg });
    } else if (existing.needsReply && !existing.userReplied && !existing.userMarkedNotNeeded) {
      toCheckSent.push(msg);
    }
  }

  // 1회 sync 한도 적용 — 나머지는 pendingCount 로 노출 (cron 다음 회차에 처리)
  if (toClassify.length > MAX_NEW_PER_SYNC) {
    pendingCount = toClassify.length - MAX_NEW_PER_SYNC;
    toClassify.length = MAX_NEW_PER_SYNC;
  }

  // Phase 2: Claude 병렬 분류 (5개씩 동시)
  for (let i = 0; i < toClassify.length; i += PARALLEL) {
    if (fatalError) {
      for (let k = i; k < toClassify.length; k++) {
        errors.push({ messageId: toClassify[k].msg.id, error: `이전 fatal 에러로 스킵: ${fatalError}` });
      }
      break;
    }
    const batch = toClassify.slice(i, i + PARALLEL);
    await Promise.all(batch.map(async ({ msg }) => {
      const fromHeader = header(msg, "From");
      const { name, email: fromEmail } = parseFrom(fromHeader);
      if (!fromEmail) return;

      const subject = header(msg, "Subject") || "(제목 없음)";
      const snippet = msg.snippet ?? "";
      const receivedAt = msg.internalDate
        ? new Date(parseInt(msg.internalDate)).toISOString()
        : new Date().toISOString();

      try {
        // 해리엇 홈페이지 문의폼 메일은 CS 인박스(lib/cs/harriotWebform)가 담당 →
        // Today Hub 는 알림·위젯에서 제외해 이중 알림 방지.
        const cls = isWebformEmail(subject, snippet)
          ? { needsReply: false, reason: "홈페이지 문의폼 — CS 인박스에서 처리", confidence: 1 }
          : await classifyOne(client, systemPrompt, {
              fromEmail, fromName: name, subject, snippet, receivedAt,
            });
        const record: ClassifiedEmail = {
          messageId:           msg.id,
          threadId:            msg.threadId,
          fromEmail,
          fromName:            name,
          subject,
          snippet,
          receivedAt,
          needsReply:          cls.needsReply,
          reason:              cls.reason,
          confidence:          cls.confidence,
          classifiedAt:        new Date().toISOString(),
          userMarkedNotNeeded: false,
          userReplied:         false,
        };
        await saveClassifiedEmail(record);
        newClassified++;

        // needsReply = true 인 경우만 텔레그램 즉시 발송 + 한 번 보낸 메일은
        // telegramNotifiedAt 마킹해 재발송 방지. 발송 실패는 sendTelegramMessage
        // 내부에서 console.error 로 기록 (silent 아님).
        if (cls.needsReply) {
          await sendTelegramMessage(formatEmailNotification(record));
          await patchClassifiedEmail(msg.id, {
            telegramNotifiedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        errors.push({ messageId: msg.id, error: errMsg });
        if (isFatalAnthropicError(e)) fatalError = errMsg;
      }
    }));
  }

  // Phase 3: 기존 needsReply 항목들 SENT 자동 감지 (병렬, Gmail API 만)
  for (let i = 0; i < toCheckSent.length; i += PARALLEL) {
    const batch = toCheckSent.slice(i, i + PARALLEL);
    await Promise.all(batch.map(async (msg) => {
      try {
        const cur = await getClassifiedEmail(msg.id);
        if (!cur) return;
        const replied = await hasSentInThread(
          token, cur.threadId, new Date(cur.receivedAt).getTime(),
        );
        if (replied) {
          await patchClassifiedEmail(cur.messageId, {
            userReplied: true,
            dismissedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        errors.push({ messageId: msg.id, error: e instanceof Error ? e.message : String(e) });
      }
    }));
  }

  return {
    lastSyncAt:    new Date().toISOString(),
    scannedCount:  messages.length,
    newClassified,
    errorCount:    errors.length,
    classificationErrors: errors.slice(0, 5),
    fatalError:    fatalError ?? undefined,
    pendingCount,
  };
}
