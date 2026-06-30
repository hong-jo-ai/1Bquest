/**
 * Solapi(솔라피) 메시지 API v4 클라이언트.
 *
 * 아웃바운드 고객 안내(배송지연·AS 등) 발송 전용. 인증은 HMAC-SHA256:
 *   signature = HMAC_SHA256(secret, date + salt)
 *   Authorization: HMAC-SHA256 apiKey=..., date=..., salt=..., signature=...
 *
 * 발신번호(SOLAPI_SENDER)는 Solapi 콘솔에 사전 등록·승인된 번호여야 한다.
 */
import { createHmac, randomBytes } from "node:crypto";

const SOLAPI_BASE = "https://api.solapi.com";

export interface SmsResult {
  phone: string;
  status: "success" | "fail";
  messageId?: string;
  error?: string;
  name?: string;   // #{이름} 치환에 쓰인 수신자명 (이력 상세용)
  text?: string;   // 실제 발송된 본문(치환 완료) (이력 상세용)
}

export interface SendOutcome {
  ok: boolean;
  groupId?: string;
  results: SmsResult[];
  successCount: number;
  failCount: number;
  error?: string;
}

/** 한글 2byte / ASCII 1byte 기준 메시지 바이트 길이 (Solapi 과금 단위). */
export function messageByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) bytes += ch.charCodeAt(0) > 0x7f ? 2 : 1;
  return bytes;
}

/** 90byte 이하면 SMS, 초과면 LMS. */
export function detectMessageType(text: string): "SMS" | "LMS" {
  return messageByteLength(text) <= 90 ? "SMS" : "LMS";
}

/** 건당 예상 단가(원) — 실제 과금은 Solapi 콘솔 기준. UI 안내용 추정치. */
const UNIT_COST: Record<"SMS" | "LMS", number> = { SMS: 20, LMS: 50 };

/** 대상 수 × 메시지 타입 단가 = 예상 총비용(원). */
export function estimateCost(text: string, recipientCount: number): number {
  return UNIT_COST[detectMessageType(text)] * recipientCount;
}

function authHeader(): string {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("SOLAPI_API_KEY / SOLAPI_API_SECRET 환경변수 누락");
  const date = new Date().toISOString();
  const salt = randomBytes(32).toString("hex");
  const signature = createHmac("sha256", apiSecret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export function getSender(): string {
  const from = process.env.SOLAPI_SENDER;
  if (!from) throw new Error("SOLAPI_SENDER(발신번호) 환경변수 누락 — Solapi 콘솔에 등록·승인된 번호 필요");
  return from.replace(/\D/g, "");
}

/** 발신번호 등 설정이 갖춰졌는지. UI 가드용. */
export function smsConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.SOLAPI_API_KEY) missing.push("SOLAPI_API_KEY");
  if (!process.env.SOLAPI_API_SECRET) missing.push("SOLAPI_API_SECRET");
  if (!process.env.SOLAPI_SENDER) missing.push("SOLAPI_SENDER");
  return { ok: missing.length === 0, missing };
}

/**
 * 카카오 알림톡(ATA) 옵션. message 에 실리면 type=ATA 로 발송된다.
 *   pfId       : Solapi에 연동한 카카오 비즈채널 ID
 *   templateId : 카카오 승인된 알림톡 템플릿 ID
 *   variables  : 템플릿 변수 치환값 ({ "#{고객명}": "홍길동", ... })
 *   disableSms : false(기본)면 알림톡 실패 시 같은 text로 SMS/LMS 대체발송
 */
export interface KakaoOptions {
  pfId: string;
  templateId: string;
  variables?: Record<string, string>;
  disableSms?: boolean;
}

interface OutMessage {
  to: string;
  from: string;
  text: string;
  type: "SMS" | "LMS" | "ATA";
  subject?: string;
  kakaoOptions?: KakaoOptions;
}

/**
 * LMS 기본 제목. 제목을 비우면 Solapi 가 본문 앞부분을 잘라 제목으로 자동 생성하는데
 * 단어 중간에서 끊겨 지저분하므로(예: "…폴바이스입니다.주"), 항상 깔끔한 제목을 강제한다.
 */
export const DEFAULT_LMS_SUBJECT = "폴바이스 고객 안내";

/**
 * 다건 발송 — send-many/detail. 수신자마다 다른 text(이름 치환)를 보낼 수 있다.
 * Solapi 는 부분 실패를 허용하므로 그룹 결과에서 건별 상태를 파싱한다.
 */
export async function sendMany(
  messages: Array<{ to: string; text: string; subject?: string; kakaoOptions?: KakaoOptions }>,
): Promise<SendOutcome> {
  if (messages.length === 0) return { ok: true, results: [], successCount: 0, failCount: 0 };
  const from = getSender();
  const payload: { messages: OutMessage[] } = {
    messages: messages.map((m) => {
      // 카카오 알림톡(ATA): kakaoOptions 가 있으면 알림톡으로 발송(실패 시 disableSms=false면 SMS 대체).
      if (m.kakaoOptions) {
        return {
          to: m.to.replace(/\D/g, ""),
          from,
          text: m.text,
          type: "ATA" as const,
          kakaoOptions: { disableSms: false, ...m.kakaoOptions },
        };
      }
      const type = detectMessageType(m.text);
      // LMS 는 제목 필수 — 미지정 시 기본 제목으로 채워 자동생성(본문 잘림)을 막는다.
      return {
        to: m.to.replace(/\D/g, ""),
        from,
        text: m.text,
        type,
        ...(type === "LMS" ? { subject: (m.subject ?? "").trim() || DEFAULT_LMS_SUBJECT } : {}),
      };
    }),
  };

  let res: Response;
  try {
    res = await fetch(`${SOLAPI_BASE}/messages/v4/send-many/detail`, {
      method: "POST",
      headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, results: [], successCount: 0, failCount: messages.length,
      error: `네트워크 오류: ${e instanceof Error ? e.message : String(e)}` };
  }

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, results: messages.map((m) => ({ phone: m.to, status: "fail" as const, error: json?.errorMessage ?? `HTTP ${res.status}`, text: m.text })),
      successCount: 0, failCount: messages.length,
      error: json?.errorMessage ?? `Solapi HTTP ${res.status}` };
  }

  // 응답: { groupInfo: { groupId, count: { total, registeredSuccess, registeredFailed ... } },
  //         failedMessageList: [{ to, statusMessage, ... }], ... }
  const groupId: string | undefined = json?.groupInfo?.groupId ?? json?.groupId;
  const failedList: any[] = json?.failedMessageList ?? [];
  const failedSet = new Map<string, string>();
  for (const f of failedList) {
    const to = String(f.to ?? "").replace(/\D/g, "");
    if (to) failedSet.set(to, f.statusMessage ?? f.statusCode ?? "발송 실패");
  }

  const results: SmsResult[] = messages.map((m) => {
    const to = m.to.replace(/\D/g, "");
    const err = failedSet.get(to);
    return err
      ? { phone: m.to, status: "fail" as const, error: err, text: m.text }
      : { phone: m.to, status: "success" as const, messageId: groupId, text: m.text };
  });
  const failCount = results.filter((r) => r.status === "fail").length;
  return { ok: failCount < results.length, groupId, results,
    successCount: results.length - failCount, failCount };
}
