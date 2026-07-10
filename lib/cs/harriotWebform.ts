/**
 * 해리엇 홈페이지 문의폼 → CS 인박스.
 *
 * shong@/info@harriotwatches.com 로 오는 웹폼 알림 메일을 CS 인박스에 적재한다.
 * 이 메일함은 cs_accounts 에 없어(등록 계정 = plvekorea@, harriotwatches@gmail) 일반 CS
 * 수집(syncAllGmailAccounts)이 못 본다 → 전용 통로.
 *
 * 특징:
 *  - 발신(From)은 info@harriotwatches.com(폼 릴레이) 자기 자신. 실제 고객 정보는 본문에
 *    라벨 형태로 들어있다:
 *      NAME: <이름> / E-MAIL: <고객이메일> / SUBJECT: <제목> / MESSAGE: <문의> / 전송일: ...
 *  - customer_handle = 파싱한 고객 이메일 → sendGmailReply 가 고객에게 직접 답장(reply.ts).
 *    (원본 스레드가 발송 계정과 다른 메일함이라, reply.ts 는 webform 스레드에 threadId 를
 *     붙이지 않고 새 메일로 발송한다.)
 */
import { getGoogleAccessTokenFromStore } from "@/lib/googleTokenStore";
import { extractBody, extractHeader, fetchRecentInboxMessages } from "./gmailClient";
import { ingestMessage } from "./store";
import type { IngestPayload } from "./types";

/** 웹폼 알림 메일 제목 패턴 (사이트빌더 관리자 알림). */
const WEBFORM_SUBJECT_RE = /폼\s*메시지|폼에서\s*보낸|form\s*(message|submission)/i;

export interface WebformParsed {
  name: string | null;
  email: string | null;
  subject: string | null;
  message: string | null;
  sentAtRaw: string | null;
}

/** 라벨형 본문(NAME:/E-MAIL:/SUBJECT:/MESSAGE:/전송일:) 파싱. */
export function parseWebform(body: string): WebformParsed {
  const pick = (re: RegExp): string | null => {
    const m = body.match(re);
    return m ? m[1].trim() : null;
  };
  // MESSAGE 는 여러 줄일 수 있어 다음 라벨(전송일/SENT/DATE) 또는 끝까지 캡처.
  const msgMatch = body.match(
    /MESSAGE\s*:\s*([\s\S]*?)(?:\n\s*(?:전송일|보낸\s*날짜|SENT|DATE)\s*:|$)/i,
  );
  return {
    name:      pick(/NAME\s*:\s*(.+)/i),
    email:     pick(/E-?MAIL\s*:\s*([^\s<>]+@[^\s<>]+)/i),
    subject:   pick(/SUBJECT\s*:\s*(.+)/i),
    message:   msgMatch ? msgMatch[1].trim() : null,
    sentAtRaw: pick(/(?:전송일|보낸\s*날짜)\s*:\s*(.+)/i),
  };
}

/** 이 메일이 해리엇 웹폼 알림인지 (제목 패턴 또는 본문 라벨 구조). */
export function isWebformEmail(subject: string, body: string): boolean {
  if (WEBFORM_SUBJECT_RE.test(subject)) return true;
  return /(^|\n)\s*NAME\s*:/i.test(body) && /(^|\n)\s*E-?MAIL\s*:/i.test(body);
}

export interface WebformSyncResult {
  scanned: number;
  ingested: number;
  skipped: number;
  errors: string[];
}

export async function syncHarriotWebform(): Promise<WebformSyncResult> {
  const result: WebformSyncResult = { scanned: 0, ingested: 0, skipped: 0, errors: [] };

  const token = await getGoogleAccessTokenFromStore();
  if (!token) {
    result.errors.push("Google 토큰 없음(shong@) — /api/auth/google/login 재연결 필요");
    return result;
  }

  let messages;
  try {
    messages = await fetchRecentInboxMessages(token, {
      maxResults: 40,
      // 백필 노이즈 최소화 위해 최근 3일. 제목에 '폼'/'form' 있는 것만 후보로.
      query: "in:inbox newer_than:3d (subject:폼 OR subject:form)",
    });
  } catch (e) {
    result.errors.push(`Gmail list 실패: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
  result.scanned = messages.length;

  for (const msg of messages) {
    try {
      const subject = extractHeader(msg, "Subject") ?? "";
      const { text } = extractBody(msg);
      const body = (text || msg.snippet || "").trim();

      if (!isWebformEmail(subject, body)) {
        result.skipped++;
        continue;
      }

      const parsed = parseWebform(body);
      if (!parsed.email) {
        // 고객 주소를 못 뽑으면 답장을 못 보내므로 적재하지 않음 (오분류 방지).
        result.skipped++;
        continue;
      }

      const dateHeader = extractHeader(msg, "Date");
      const sentAt =
        parsed.sentAtRaw && !Number.isNaN(Date.parse(parsed.sentAtRaw))
          ? new Date(parsed.sentAtRaw)
          : dateHeader && !Number.isNaN(Date.parse(dateHeader))
          ? new Date(dateHeader)
          : new Date();

      const payload: IngestPayload = {
        brand: "harriot",
        channel: "gmail",
        externalThreadId: msg.threadId,
        externalMessageId: msg.id,
        customerHandle: parsed.email,
        customerName: parsed.name ?? undefined,
        subject: parsed.subject ? `[문의폼] ${parsed.subject}` : "[문의폼] 홈페이지 문의",
        bodyText: parsed.message ?? body,
        sentAt,
        direction: "in",
        raw: { source: "webform", snippet: msg.snippet, parsed },
      };

      const r = await ingestMessage(payload);
      if (r.inserted) result.ingested++;
      else result.skipped++;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  return result;
}
